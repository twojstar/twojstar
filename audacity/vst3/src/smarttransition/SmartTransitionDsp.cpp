#include "SmartTransitionDsp.h"

#include <algorithm>
#include <cmath>

namespace Travny::Audio {
namespace {

constexpr double kPi = 3.141592653589793238462643383279502884;
constexpr double kCandidateThreshold = 0.62;

[[nodiscard]] double dbToGain(double db) noexcept
{
    return std::pow(10.0, db / 20.0);
}

[[nodiscard]] double clampFinite(double value, double low, double high) noexcept
{
    return std::isfinite(value) ? std::clamp(value, low, high) : 0.0;
}

} // namespace

SmartTransitionDsp::SmartTransitionDsp() noexcept
{
    configure(48000.0);
}

void SmartTransitionDsp::configure(double sampleRate) noexcept
{
    sampleRate_ = std::isfinite(sampleRate) && sampleRate > 1000.0 ? sampleRate : 48000.0;

    lookaheadSamples_ = static_cast<std::size_t>(std::clamp<long long>(
        std::llround(sampleRate_ * 0.100),
        static_cast<long long>(kMinLookaheadSamples),
        static_cast<long long>(kMaxLookaheadSamples)));

    analysisRadius_ = static_cast<std::size_t>(std::clamp<long long>(
        std::llround(sampleRate_ * 0.001), 32, 128));

    const auto maximumFade = std::max<std::size_t>(32, lookaheadSamples_ / 2);
    fadeLengthSamples_ = static_cast<std::size_t>(std::clamp<long long>(
        std::llround(sampleRate_ * 0.004), 32, static_cast<long long>(maximumFade)));
    if ((fadeLengthSamples_ & 1U) != 0U)
    {
        ++fadeLengthSamples_;
    }

    // Any candidates whose transition intervals can overlap must compete before a plan commits.
    competitionRadius_ = std::max(analysisRadius_, fadeLengthSamples_);
    reset();
}

void SmartTransitionDsp::reset() noexcept
{
    inputCount_ = 0;
    drainStarted_ = false;
    clusterBest_ = {};
    clusterLastQualifiedAnchor_ = -1;
    clusterActive_ = false;
    plan_ = {};
    planCommitted_ = false;
    committedAnchor_ = -1;
    planWindowStart_ = 0;
}

void SmartTransitionDsp::processFrame(const double* input, double* output, std::size_t channels) noexcept
{
    processFrameInternal(input, output, channels, true);
}

void SmartTransitionDsp::drainFrame(double* output, std::size_t channels) noexcept
{
    if (!drainStarted_)
    {
        drainStarted_ = true;

        if (!planCommitted_ && clusterActive_ && inputCount_ > 0)
        {
            finalizeCluster(inputCount_ - 1);
        }

        if (!planCommitted_ && !clusterActive_)
        {
            scanShortSelection(channels);
        }
    }

    const std::array<double, kMaxChannels> silence{};
    processFrameInternal(silence.data(), output, channels, false);
}

void SmartTransitionDsp::processFrameInternal(
    const double* input,
    double* output,
    std::size_t channels,
    bool analyze) noexcept
{
    channels = std::clamp<std::size_t>(channels, 1, kMaxChannels);
    const auto inputIndex = inputCount_;
    storeFrame(input, channels, inputIndex);
    ++inputCount_;

    if (analyze && !planCommitted_)
    {
        const auto rightContext = static_cast<std::int64_t>(analysisRadius_);
        if (inputIndex >= rightContext + static_cast<std::int64_t>(analysisRadius_) + 2)
        {
            const auto anchor = inputIndex - rightContext;
            considerCandidate(scoreCandidate(anchor, channels, analysisRadius_), inputIndex);
        }
    }

    const auto outputIndex = inputIndex - static_cast<std::int64_t>(lookaheadSamples_);
    for (std::size_t channel = 0; channel < channels; ++channel)
    {
        output[channel] = outputIndex >= 0 ? renderSample(channel, outputIndex) : 0.0;
    }
    for (std::size_t channel = channels; channel < kMaxChannels; ++channel)
    {
        if (output != nullptr)
        {
            output[channel] = 0.0;
        }
    }
}

void SmartTransitionDsp::storeFrame(const double* input, std::size_t channels, std::int64_t index) noexcept
{
    const auto slot = static_cast<std::size_t>(index) % kRingCapacity;
    for (std::size_t channel = 0; channel < kMaxChannels; ++channel)
    {
        ring_[channel][slot] = channel < channels && input != nullptr && std::isfinite(input[channel])
            ? input[channel]
            : 0.0;
    }
}

double SmartTransitionDsp::sampleAt(std::size_t channel, std::int64_t index) const noexcept
{
    if (channel >= kMaxChannels || index < 0 || index >= inputCount_)
    {
        return 0.0;
    }

    const auto age = inputCount_ - 1 - index;
    if (age >= static_cast<std::int64_t>(kRingCapacity))
    {
        return 0.0;
    }

    return ring_[channel][static_cast<std::size_t>(index) % kRingCapacity];
}

SmartTransitionDsp::Candidate SmartTransitionDsp::scoreCandidate(
    std::int64_t anchor,
    std::size_t channels,
    std::size_t radiusValue) const noexcept
{
    Candidate candidate{};
    candidate.anchor = anchor;
    candidate.analysisRadius = radiusValue;

    channels = std::clamp<std::size_t>(channels, 1, kMaxChannels);
    const auto radius = static_cast<std::int64_t>(radiusValue);
    if (radius < static_cast<std::int64_t>(kMinAnalysisRadiusSamples) ||
        anchor < radius + 2 || anchor + radius >= inputCount_)
    {
        return candidate;
    }

    double strongestScore = 0.0;
    for (std::size_t channel = 0; channel < channels; ++channel)
    {
        double leftSum = 0.0;
        double rightSum = 0.0;
        double leftSquares = 0.0;
        double rightSquares = 0.0;
        for (std::int64_t i = 0; i < radius; ++i)
        {
            const auto left = sampleAt(channel, anchor - radius + i);
            const auto right = sampleAt(channel, anchor + i);
            leftSum += left;
            rightSum += right;
            leftSquares += left * left;
            rightSquares += right * right;
        }

        const auto leftMean = leftSum / static_cast<double>(radius);
        const auto rightMean = rightSum / static_cast<double>(radius);
        const auto leftRms = std::sqrt(leftSquares / static_cast<double>(radius));
        const auto rightRms = std::sqrt(rightSquares / static_cast<double>(radius));

        candidate.leftMean += leftMean;
        candidate.rightMean += rightMean;
        candidate.leftRms += leftRms;
        candidate.rightRms += rightRms;

        double derivativeSum = 0.0;
        std::int64_t derivativeCount = 0;
        for (std::int64_t i = anchor - radius + 1; i < anchor; ++i)
        {
            derivativeSum += std::abs(sampleAt(channel, i) - sampleAt(channel, i - 1));
            ++derivativeCount;
        }
        for (std::int64_t i = anchor + 1; i < anchor + radius; ++i)
        {
            derivativeSum += std::abs(sampleAt(channel, i) - sampleAt(channel, i - 1));
            ++derivativeCount;
        }

        const auto baselineDerivative = derivativeCount > 0
            ? derivativeSum / static_cast<double>(derivativeCount)
            : 0.0;
        const auto jump = std::abs(sampleAt(channel, anchor) - sampleAt(channel, anchor - 1));
        const auto meanGap = std::abs(rightMean - leftMean);
        const auto localLevel = 0.5 * (leftRms + rightRms);
        const auto epsilon = 1e-9;

        const auto jumpScore = jump / (jump + 4.0 * baselineDerivative + epsilon);
        const auto meanScore = meanGap / (meanGap + 0.25 * localLevel + 4.0 * baselineDerivative + epsilon);
        const auto channelScore = std::clamp(0.82 * jumpScore + 0.18 * meanScore, 0.0, 1.0);
        strongestScore = std::max(strongestScore, channelScore);
    }

    const auto channelScale = 1.0 / static_cast<double>(channels);
    candidate.leftMean *= channelScale;
    candidate.rightMean *= channelScale;
    candidate.leftRms *= channelScale;
    candidate.rightRms *= channelScale;

    const auto score = strongestScore;
    if (!std::isfinite(score))
    {
        return candidate;
    }

    candidate.scoreKey = static_cast<std::int64_t>(std::llround(score * static_cast<double>(kScoreScale)));
    candidate.confidence = static_cast<double>(candidate.scoreKey) / static_cast<double>(kScoreScale);
    candidate.valid = candidate.confidence >= kCandidateThreshold;
    return candidate;
}

void SmartTransitionDsp::considerCandidate(const Candidate& candidate, std::int64_t currentInputIndex) noexcept
{
    if (planCommitted_)
    {
        return;
    }

    if (clusterActive_ && candidate.anchor - clusterLastQualifiedAnchor_ > static_cast<std::int64_t>(competitionRadius_))
    {
        finalizeCluster(currentInputIndex);
        if (planCommitted_)
        {
            return;
        }
    }

    if (!candidate.valid)
    {
        return;
    }

    if (!clusterActive_)
    {
        clusterActive_ = true;
        clusterBest_ = candidate;
        clusterLastQualifiedAnchor_ = candidate.anchor;
        return;
    }

    clusterLastQualifiedAnchor_ = candidate.anchor;
    if (candidate.scoreKey > clusterBest_.scoreKey ||
        (candidate.scoreKey == clusterBest_.scoreKey && candidate.anchor < clusterBest_.anchor))
    {
        clusterBest_ = candidate;
    }
}

void SmartTransitionDsp::scanShortSelection(std::size_t channels) noexcept
{
    if (planCommitted_ || clusterActive_ || inputCount_ <= 0 ||
        inputCount_ >= static_cast<std::int64_t>(2 * analysisRadius_ + 4))
    {
        return;
    }

    Candidate best{};
    const auto minimumRadius = static_cast<std::int64_t>(kMinAnalysisRadiusSamples);
    for (std::int64_t anchor = minimumRadius + 2;
         anchor + minimumRadius < inputCount_;
         ++anchor)
    {
        const auto leftAvailable = anchor - 2;
        const auto rightAvailable = inputCount_ - anchor - 1;
        const auto radius = static_cast<std::size_t>(std::min<std::int64_t>({
            static_cast<std::int64_t>(analysisRadius_), leftAvailable, rightAvailable}));
        if (radius < kMinAnalysisRadiusSamples)
        {
            continue;
        }

        const auto candidate = scoreCandidate(anchor, channels, radius);
        if (!candidate.valid)
        {
            continue;
        }

        if (!best.valid || candidate.scoreKey > best.scoreKey ||
            (candidate.scoreKey == best.scoreKey && candidate.anchor < best.anchor))
        {
            best = candidate;
        }
    }

    if (best.valid)
    {
        clusterActive_ = true;
        clusterBest_ = best;
        clusterLastQualifiedAnchor_ = best.anchor;
        finalizeCluster(inputCount_ - 1);
    }
}

void SmartTransitionDsp::finalizeCluster(std::int64_t currentInputIndex) noexcept
{
    if (!clusterActive_ || !clusterBest_.valid || planCommitted_)
    {
        clusterActive_ = false;
        clusterBest_ = {};
        clusterLastQualifiedAnchor_ = -1;
        return;
    }

    const auto leftCapacity = clusterBest_.anchor - 2;
    const auto rightCapacity = inputCount_ - clusterBest_.anchor - 2;
    const auto preferredHalfFade = static_cast<std::int64_t>(fadeLengthSamples_ / 2);
    const auto halfFade = std::min({preferredHalfFade, leftCapacity, rightCapacity});
    const auto effectiveFadeLength = halfFade > 0 ? static_cast<std::size_t>(halfFade * 2) : 0;

    const auto transitionStart = clusterBest_.anchor - halfFade;
    const auto transitionEnd = transitionStart + static_cast<std::int64_t>(effectiveFadeLength);
    const auto emissionFrontier = currentInputIndex - static_cast<std::int64_t>(lookaheadSamples_);

    if (effectiveFadeLength >= kMinFadeLengthSamples &&
        transitionStart >= 2 && transitionEnd + 1 < inputCount_ && emissionFrontier <= transitionStart)
    {
        plan_ = makePlan(clusterBest_, effectiveFadeLength);
        const auto analysisStart = clusterBest_.anchor - static_cast<std::int64_t>(clusterBest_.analysisRadius);
        planWindowStart_ = std::min(analysisStart, transitionStart);
        plan_.seamAnchorSamples = clusterBest_.anchor - planWindowStart_;
        committedAnchor_ = clusterBest_.anchor;
        planCommitted_ = !plan_.noOp;
    }

    clusterActive_ = false;
    clusterBest_ = {};
    clusterLastQualifiedAnchor_ = -1;
}

SmartEditPlan SmartTransitionDsp::makePlan(const Candidate& candidate, std::size_t fadeLength) const noexcept
{
    SmartEditPlan plan{};
    if (!candidate.valid || fadeLength < kMinFadeLengthSamples)
    {
        return plan;
    }

    const auto epsilon = 1e-9;
    const auto ratio = (candidate.leftRms + epsilon) / (candidate.rightRms + epsilon);
    auto rightGainDb = clampFinite(20.0 * std::log10(ratio), -3.0, 3.0);
    if (std::abs(rightGainDb) < 0.10)
    {
        rightGainDb = 0.0;
    }

    plan.confidence = candidate.confidence;
    plan.leftGainDb = 0.0;
    plan.rightGainDb = rightGainDb;
    plan.dcDelta = clampFinite(candidate.rightMean - candidate.leftMean, -0.35, 0.35);
    plan.timingOffsetSamples = 0;
    plan.fadeLengthSamples = static_cast<std::int32_t>(fadeLength);
    plan.fadeCurve = SmartFadeCurve::SCurve;
    plan.repairMode = SmartRepairMode::None;
    plan.noOp = false;
    return plan;
}

double SmartTransitionDsp::renderSample(std::size_t channel, std::int64_t outputIndex) const noexcept
{
    const auto source = sampleAt(channel, outputIndex);
    if (!planCommitted_ || committedAnchor_ < 0 || plan_.fadeLengthSamples <= 0)
    {
        return source;
    }

    const auto fadeLength = static_cast<std::int64_t>(plan_.fadeLengthSamples);
    const auto start = committedAnchor_ - fadeLength / 2;
    const auto end = start + fadeLength;
    if (outputIndex < start || outputIndex >= end)
    {
        return source;
    }

    const auto t = static_cast<double>(outputIndex - start + 1) / static_cast<double>(fadeLength + 1);
    const auto bridgeWeight = std::pow(std::sin(kPi * t), 2.0);

    const auto leftEdge = sampleAt(channel, start - 1);
    const auto rightEdge = sampleAt(channel, end);
    const auto leftSlope = leftEdge - sampleAt(channel, start - 2);
    const auto rightSlope = sampleAt(channel, end + 1) - rightEdge;
    const auto span = static_cast<double>(fadeLength + 1);

    const auto t2 = t * t;
    const auto t3 = t2 * t;
    const auto h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    const auto h10 = t3 - 2.0 * t2 + t;
    const auto h01 = -2.0 * t3 + 3.0 * t2;
    const auto h11 = t3 - t2;
    auto bridge = h00 * leftEdge + h10 * span * leftSlope + h01 * rightEdge + h11 * span * rightSlope;

    const auto envelope = std::max({std::abs(source), std::abs(leftEdge), std::abs(rightEdge), 1e-6});
    bridge = std::clamp(bridge, -1.5 * envelope, 1.5 * envelope);

    auto corrected = source;
    if (outputIndex < committedAnchor_)
    {
        const auto denominator = std::max<std::int64_t>(1, committedAnchor_ - start);
        const auto amount = static_cast<double>(outputIndex - start + 1) / static_cast<double>(denominator);
        corrected *= dbToGain(plan_.leftGainDb * std::clamp(amount, 0.0, 1.0));
    }
    else
    {
        const auto denominator = std::max<std::int64_t>(1, end - committedAnchor_);
        const auto amount = static_cast<double>(end - outputIndex) / static_cast<double>(denominator);
        const auto taper = std::clamp(amount, 0.0, 1.0);
        corrected = corrected * dbToGain(plan_.rightGainDb * taper) - plan_.dcDelta * taper;
    }

    return corrected * (1.0 - bridgeWeight) + bridge * bridgeWeight;
}

} // namespace Travny::Audio
