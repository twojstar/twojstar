#include "AutoDeclipDsp.h"

#include <algorithm>
#include <cmath>

namespace Travny::Audio {
namespace {
constexpr double kPi = 3.14159265358979323846;
constexpr double kSafePeak = 0.999;
}

void AutoDeclipDsp::reset() noexcept
{
    buffer_.fill(0.0);
    nextIndex_ = 0;
    clipStart_ = 0;
    pendingStart_ = 0;
    pendingEnd_ = 0;
    inClip_ = false;
    repairPending_ = false;
}

double AutoDeclipDsp::sampleAt(std::uint64_t index) const noexcept
{
    return buffer_[static_cast<std::size_t>(index % kBufferSize)];
}

double& AutoDeclipDsp::sampleAt(std::uint64_t index) noexcept
{
    return buffer_[static_cast<std::size_t>(index % kBufferSize)];
}

double AutoDeclipDsp::processSampleImpl(double input) noexcept
{
    const std::uint64_t index = nextIndex_++;
    sampleAt(index) = input;

    const bool clipped = std::abs(input) >= kClipThreshold;
    if (clipped)
    {
        if (!inClip_)
        {
            clipStart_ = index;
            inClip_ = true;
        }
    }
    else if (inClip_)
    {
        const std::uint64_t runLength = index - clipStart_;
        if (runLength >= 2 && runLength <= kMaxRepairSamples && clipStart_ >= 1)
        {
            pendingStart_ = clipStart_;
            pendingEnd_ = index;
            repairPending_ = true;
        }
        inClip_ = false;
    }

    if (repairPending_ && index > pendingEnd_)
    {
        repairPendingRun(index);
        repairPending_ = false;
    }

    if (index < kLatencySamples)
    {
        return 0.0;
    }

    return sampleAt(index - kLatencySamples);
}

void AutoDeclipDsp::repairPendingRun(std::uint64_t rightContextIndex) noexcept
{
    const std::uint64_t runLength = pendingEnd_ - pendingStart_;
    if (runLength < 2 || runLength > kMaxRepairSamples || pendingStart_ == 0)
    {
        return;
    }

    const double left = sampleAt(pendingStart_ - 1);
    const double right = sampleAt(pendingEnd_);
    const double rightContext = sampleAt(rightContextIndex);

    const bool sameSign = (left >= 0.0 && right >= 0.0) || (left <= 0.0 && right <= 0.0);
    const bool nearPeak = std::abs(left) >= 0.5 && std::abs(right) >= 0.5;
    const bool cleanRightContext = std::abs(rightContext) < kClipThreshold;

    const double edgePeak = std::max(std::abs(left), std::abs(right));
    const double headroom = std::clamp(kSafePeak - edgePeak, 0.0, 0.12);
    const double sign = left < 0.0 ? -1.0 : 1.0;

    for (std::uint64_t offset = 0; offset < runLength; ++offset)
    {
        const double t = static_cast<double>(offset + 1) / static_cast<double>(runLength + 1);
        double repaired = left + (right - left) * t;

        if (sameSign && nearPeak && cleanRightContext && headroom > 0.0)
        {
            repaired += sign * headroom * std::sin(kPi * t);
        }

        sampleAt(pendingStart_ + offset) = std::clamp(repaired, -kSafePeak, kSafePeak);
    }
}

} // namespace Travny::Audio
