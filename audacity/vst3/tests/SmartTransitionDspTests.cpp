#include "SmartTransitionDsp.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <vector>

using Travny::Audio::SmartEditPlan;
using Travny::Audio::SmartTransitionDsp;

namespace {

using Frame = std::array<double, 2>;

void require(bool condition, const char* message)
{
    if (!condition)
    {
        throw std::runtime_error(message);
    }
}

struct RenderResult
{
    std::vector<Frame> output;
    SmartEditPlan plan{};
    std::int64_t planWindowStart{0};
    bool hasPlan{false};
};

RenderResult render(const std::vector<Frame>& input, std::size_t channels, const std::vector<std::size_t>& chunks = {})
{
    SmartTransitionDsp dsp;
    dsp.configure(48000.0);

    std::vector<Frame> raw;
    raw.reserve(input.size() + dsp.latencySamples());

    std::size_t position = 0;
    std::size_t chunkIndex = 0;
    while (position < input.size())
    {
        const auto requested = chunks.empty() ? input.size() : chunks[chunkIndex++ % chunks.size()];
        const auto count = std::min(requested, input.size() - position);
        for (std::size_t i = 0; i < count; ++i)
        {
            Frame out{};
            dsp.processFrame(input[position + i].data(), out.data(), channels);
            raw.push_back(out);
        }
        position += count;
    }

    for (std::size_t i = 0; i < dsp.latencySamples(); ++i)
    {
        Frame out{};
        dsp.drainFrame(out.data(), channels);
        raw.push_back(out);
    }

    RenderResult result;
    result.output.assign(
        raw.begin() + static_cast<std::ptrdiff_t>(dsp.latencySamples()),
        raw.begin() + static_cast<std::ptrdiff_t>(dsp.latencySamples() + input.size()));
    result.hasPlan = dsp.hasPlan();
    result.plan = dsp.plan();
    result.planWindowStart = dsp.planWindowStartSamples();
    return result;
}

std::vector<Frame> cleanSine(std::size_t count, std::size_t channels = 2)
{
    std::vector<Frame> input(count);
    for (std::size_t i = 0; i < count; ++i)
    {
        const auto phase = static_cast<double>(i) * 0.05;
        input[i][0] = 0.55 * std::sin(phase);
        input[i][1] = channels > 1 ? 0.35 * std::sin(phase + 0.13) : 0.0;
    }
    return input;
}

std::vector<Frame> withHardSeam(std::size_t count, std::size_t seam)
{
    auto input = cleanSine(count);
    for (std::size_t i = seam; i < count; ++i)
    {
        input[i][0] += 0.45;
        input[i][1] += 0.38;
    }
    return input;
}

std::int64_t globalAnchor(const RenderResult& result)
{
    return result.planWindowStart + result.plan.seamAnchorSamples;
}

void testCleanAudioIsBitTransparent()
{
    const auto input = cleanSine(1200);
    const auto result = render(input, 2, {1, 7, 64, 13, 128});

    require(!result.hasPlan, "clean sine should not produce a transition plan");
    require(result.output.size() == input.size(), "clean output size changed");
    for (std::size_t i = 0; i < input.size(); ++i)
    {
        require(result.output[i][0] == input[i][0], "clean left channel changed");
        require(result.output[i][1] == input[i][1], "clean right channel changed");
    }
}

void testHardSeamIsDetectedAndSmoothed()
{
    constexpr std::size_t seam = 500;
    const auto input = withHardSeam(1400, seam);
    const auto result = render(input, 2, {31, 97, 5, 128});

    require(result.hasPlan, "hard seam was not detected");
    require(!result.plan.noOp, "hard seam produced a no-op plan");
    require(result.plan.fadeLengthSamples > 0, "hard seam has no transition length");
    require(result.plan.confidence >= 0.62, "hard seam confidence below threshold");
    require(std::llabs(globalAnchor(result) - static_cast<std::int64_t>(seam)) <= 2,
            "detected seam moved away from the actual splice");

    const auto beforeJump = std::abs(input[seam][0] - input[seam - 1][0]);
    const auto afterJump = std::abs(result.output[seam][0] - result.output[seam - 1][0]);
    require(afterJump < beforeJump * 0.55, "transition did not sufficiently soften the seam");

    require(result.output[40] == input[40], "samples far before the seam changed");
    require(result.output[1200] == input[1200], "samples far after the seam changed");
}

void testBlockPartitionIsDeterministic()
{
    const auto input = withHardSeam(1500, 620);
    const auto a = render(input, 2, {1500});
    const auto b = render(input, 2, {1, 2, 3, 5, 8, 13, 21, 34, 55, 89});

    require(a.hasPlan && b.hasPlan, "partition test did not produce plans");
    require(a.planWindowStart == b.planWindowStart, "plan window changed with block partition");
    require(a.plan.seamAnchorSamples == b.plan.seamAnchorSamples, "seam changed with block partition");
    require(a.plan.confidence == b.plan.confidence, "confidence changed with block partition");
    require(a.plan.rightGainDb == b.plan.rightGainDb, "gain plan changed with block partition");
    require(a.plan.dcDelta == b.plan.dcDelta, "DC plan changed with block partition");
    require(a.plan.fadeLengthSamples == b.plan.fadeLengthSamples, "fade length changed with block partition");
    require(a.output == b.output, "rendered samples changed with block partition");
}

void testOverlappingCandidatesCompeteBeforeCommit()
{
    constexpr std::size_t firstSeam = 500;
    constexpr std::size_t strongerSeam = 650;
    std::vector<Frame> input(1500);
    for (std::size_t i = 0; i < input.size(); ++i)
    {
        const double value = i < firstSeam ? 0.40 : (i < strongerSeam ? 0.50 : -0.50);
        input[i] = {value, value * 0.9};
    }

    const auto result = render(input, 2, {23, 41, 67});
    require(result.hasPlan, "overlapping-candidate fixture did not produce a plan");
    require(std::llabs(globalAnchor(result) - static_cast<std::int64_t>(strongerSeam)) <= 2,
            "an earlier weaker overlapping seam committed before the stronger candidate");
}

void testFinalClusterCommitsDuringDrain()
{
    constexpr std::size_t seam = 700;
    std::vector<Frame> input(800);
    for (std::size_t i = 0; i < input.size(); ++i)
    {
        const double value = i < seam ? 0.25 : -0.60;
        input[i] = {value, value * 0.8};
    }

    const auto result = render(input, 2, {37, 19, 71});
    require(result.hasPlan, "final fully observed seam was lost at end-of-input");
    require(std::llabs(globalAnchor(result) - static_cast<std::int64_t>(seam)) <= 2,
            "drain committed the wrong final seam");
}

void testShortSelectionShrinksAnalysisSymmetrically()
{
    constexpr std::size_t seam = 40;
    std::vector<Frame> input(80);
    for (std::size_t i = 0; i < input.size(); ++i)
    {
        const double value = i < seam ? 0.30 : -0.50;
        input[i] = {value, value * 0.85};
    }

    const auto result = render(input, 2, {7, 11, 5});
    require(result.hasPlan, "short selection did not shrink analysis context");
    require(result.plan.fadeLengthSamples < 192, "short selection did not shrink transition to available context");
    require(std::llabs(globalAnchor(result) - static_cast<std::int64_t>(seam)) <= 2,
            "short-selection seam anchor is incorrect");
}

void testAntiPhaseStereoSeamDoesNotCancelDetection()
{
    constexpr std::size_t seam = 500;
    std::vector<Frame> input(1400);
    for (std::size_t i = 0; i < input.size(); ++i)
    {
        input[i] = i < seam ? Frame{0.45, -0.45} : Frame{-0.45, 0.45};
    }

    const auto result = render(input, 2, {29, 3, 83});
    require(result.hasPlan, "anti-phase stereo seam cancelled out of detection");
    require(std::llabs(globalAnchor(result) - static_cast<std::int64_t>(seam)) <= 2,
            "anti-phase stereo seam anchor is incorrect");

    for (std::size_t channel = 0; channel < 2; ++channel)
    {
        const auto beforeJump = std::abs(input[seam][channel] - input[seam - 1][channel]);
        const auto afterJump = std::abs(result.output[seam][channel] - result.output[seam - 1][channel]);
        require(afterJump < beforeJump * 0.55, "anti-phase stereo seam was not smoothed on both channels");
    }
}

void testMonoPath()
{
    constexpr std::size_t seam = 420;
    auto input = cleanSine(1200, 1);
    for (std::size_t i = seam; i < input.size(); ++i)
    {
        input[i][0] -= 0.50;
    }

    const auto result = render(input, 1, {17, 63, 4});
    require(result.hasPlan, "mono seam was not detected");
    require(std::llabs(globalAnchor(result) - static_cast<std::int64_t>(seam)) <= 2,
            "mono seam anchor is incorrect");
}

void testResetStartsFreshRun()
{
    SmartTransitionDsp dsp;
    dsp.configure(48000.0);
    const auto input = withHardSeam(1300, 500);
    for (const auto& frame : input)
    {
        Frame out{};
        dsp.processFrame(frame.data(), out.data(), 2);
    }
    require(dsp.hasPlan(), "first run did not commit a plan");

    dsp.reset();
    require(!dsp.hasPlan(), "reset retained the accepted plan");
    require(dsp.plan().noOp, "reset plan is not neutral");

    const auto clean = cleanSine(300);
    for (const auto& frame : clean)
    {
        Frame out{};
        dsp.processFrame(frame.data(), out.data(), 2);
    }
    require(!dsp.hasPlan(), "fresh run inherited seam state");
}

} // namespace

int main()
{
    try
    {
        testCleanAudioIsBitTransparent();
        testHardSeamIsDetectedAndSmoothed();
        testBlockPartitionIsDeterministic();
        testOverlappingCandidatesCompeteBeforeCommit();
        testFinalClusterCommitsDuringDrain();
        testShortSelectionShrinksAnalysisSymmetrically();
        testAntiPhaseStereoSeamDoesNotCancelDetection();
        testMonoPath();
        testResetStartsFreshRun();
        std::cout << "SmartTransition DSP tests passed\n";
        return EXIT_SUCCESS;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return EXIT_FAILURE;
    }
}
