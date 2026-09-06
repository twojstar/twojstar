#include "SmartTransitionProcessor.h"

#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/vstspeaker.h"

#include <algorithm>
#include <array>

namespace Travny::Vst3 {

SmartTransitionProcessor::SmartTransitionProcessor()
{
    setControllerClass(kSmartTransitionControllerUid);
}

Steinberg::tresult PLUGIN_API SmartTransitionProcessor::initialize(Steinberg::FUnknown* context)
{
    const auto result = AudioEffect::initialize(context);
    if (result != Steinberg::kResultOk)
    {
        return result;
    }

    addAudioInput(STR16("Input"), Steinberg::Vst::SpeakerArr::kStereo);
    addAudioOutput(STR16("Output"), Steinberg::Vst::SpeakerArr::kStereo);
    return Steinberg::kResultOk;
}

Steinberg::tresult PLUGIN_API SmartTransitionProcessor::setActive(Steinberg::TBool state)
{
    dsp_.reset();
    return AudioEffect::setActive(state);
}

Steinberg::tresult PLUGIN_API SmartTransitionProcessor::setProcessing(Steinberg::TBool state)
{
    dsp_.reset();
    return AudioEffect::setProcessing(state);
}

Steinberg::tresult PLUGIN_API SmartTransitionProcessor::setupProcessing(Steinberg::Vst::ProcessSetup& setup)
{
    const auto result = AudioEffect::setupProcessing(setup);
    if (result == Steinberg::kResultOk)
    {
        dsp_.configure(setup.sampleRate);
    }
    return result;
}

Steinberg::tresult PLUGIN_API SmartTransitionProcessor::setBusArrangements(
    Steinberg::Vst::SpeakerArrangement* inputs,
    Steinberg::int32 numIns,
    Steinberg::Vst::SpeakerArrangement* outputs,
    Steinberg::int32 numOuts)
{
    if (numIns != 1 || numOuts != 1)
    {
        return Steinberg::kResultFalse;
    }

    const auto inputChannels = Steinberg::Vst::SpeakerArr::getChannelCount(inputs[0]);
    const auto outputChannels = Steinberg::Vst::SpeakerArr::getChannelCount(outputs[0]);
    if (inputChannels != outputChannels || (inputChannels != 1 && inputChannels != 2))
    {
        return Steinberg::kResultFalse;
    }

    getAudioInput(0)->setArrangement(inputs[0]);
    getAudioOutput(0)->setArrangement(outputs[0]);
    dsp_.reset();
    return Steinberg::kResultOk;
}

Steinberg::tresult PLUGIN_API SmartTransitionProcessor::canProcessSampleSize(Steinberg::int32 symbolicSampleSize)
{
    return symbolicSampleSize == Steinberg::Vst::kSample32 || symbolicSampleSize == Steinberg::Vst::kSample64
        ? Steinberg::kResultTrue
        : Steinberg::kResultFalse;
}

Steinberg::uint32 PLUGIN_API SmartTransitionProcessor::getLatencySamples()
{
    return static_cast<Steinberg::uint32>(dsp_.latencySamples());
}

Steinberg::uint32 PLUGIN_API SmartTransitionProcessor::getTailSamples()
{
    // Lookahead is reported as latency. Smart Transition generates no post-input effect tail.
    return Steinberg::Vst::kNoTail;
}

template <typename Sample>
bool SmartTransitionProcessor::validateBuffers(
    Sample** input,
    Sample** output,
    Steinberg::int32 channels,
    Steinberg::uint64 inputSilenceFlags) noexcept
{
    if (output == nullptr)
    {
        return false;
    }

    for (Steinberg::int32 channel = 0; channel < channels; ++channel)
    {
        const auto bit = Steinberg::uint64{1} << static_cast<Steinberg::uint32>(channel);
        if (output[channel] == nullptr)
        {
            return false;
        }
        if ((inputSilenceFlags & bit) == 0 && (input == nullptr || input[channel] == nullptr))
        {
            return false;
        }
    }

    return true;
}

template <typename Sample>
bool SmartTransitionProcessor::processBlock(
    Sample** input,
    Sample** output,
    Steinberg::int32 channels,
    Steinberg::int32 samples,
    Steinberg::uint64 inputSilenceFlags) noexcept
{
    bool allSilent = true;
    const auto channelCount = std::clamp<Steinberg::int32>(channels, 1, 2);

    for (Steinberg::int32 sample = 0; sample < samples; ++sample)
    {
        std::array<double, Travny::Audio::SmartTransitionDsp::kMaxChannels> inputFrame{};
        std::array<double, Travny::Audio::SmartTransitionDsp::kMaxChannels> outputFrame{};
        for (Steinberg::int32 channel = 0; channel < channelCount; ++channel)
        {
            const auto bit = Steinberg::uint64{1} << static_cast<Steinberg::uint32>(channel);
            const auto channelIsSilent = (inputSilenceFlags & bit) != 0;
            inputFrame[static_cast<std::size_t>(channel)] = channelIsSilent
                ? 0.0
                : static_cast<double>(input[channel][sample]);
        }

        // Read the complete input frame before writing output, so aliased in-place buffers are safe.
        dsp_.processFrame(inputFrame.data(), outputFrame.data(), static_cast<std::size_t>(channelCount));
        for (Steinberg::int32 channel = 0; channel < channelCount; ++channel)
        {
            const auto value = static_cast<Sample>(outputFrame[static_cast<std::size_t>(channel)]);
            output[channel][sample] = value;
            allSilent = allSilent && value == static_cast<Sample>(0);
        }
    }

    return allSilent;
}

Steinberg::tresult PLUGIN_API SmartTransitionProcessor::process(Steinberg::Vst::ProcessData& data)
{
    if (data.numInputs == 0 || data.numOutputs == 0 || data.numSamples <= 0)
    {
        return Steinberg::kResultOk;
    }

    const auto channels = data.inputs[0].numChannels;
    if (channels < 1 || channels > 2 || data.outputs[0].numChannels != channels)
    {
        return Steinberg::kResultFalse;
    }

    const auto inputSilenceFlags = data.inputs[0].silenceFlags;
    bool allSilent = false;
    if (data.symbolicSampleSize == Steinberg::Vst::kSample32)
    {
        auto** input = data.inputs[0].channelBuffers32;
        auto** output = data.outputs[0].channelBuffers32;
        if (!validateBuffers(input, output, channels, inputSilenceFlags))
        {
            return Steinberg::kResultFalse;
        }
        allSilent = processBlock(input, output, channels, data.numSamples, inputSilenceFlags);
    }
    else if (data.symbolicSampleSize == Steinberg::Vst::kSample64)
    {
        auto** input = data.inputs[0].channelBuffers64;
        auto** output = data.outputs[0].channelBuffers64;
        if (!validateBuffers(input, output, channels, inputSilenceFlags))
        {
            return Steinberg::kResultFalse;
        }
        allSilent = processBlock(input, output, channels, data.numSamples, inputSilenceFlags);
    }
    else
    {
        return Steinberg::kResultFalse;
    }

    data.outputs[0].silenceFlags = allSilent
        ? ((Steinberg::uint64{1} << static_cast<Steinberg::uint32>(channels)) - 1)
        : 0;
    return Steinberg::kResultOk;
}

} // namespace Travny::Vst3
