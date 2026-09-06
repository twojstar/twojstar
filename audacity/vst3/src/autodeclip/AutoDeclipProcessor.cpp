#include "AutoDeclipProcessor.h"

#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/vstspeaker.h"

#include <algorithm>

namespace Travny::Vst3 {

AutoDeclipProcessor::AutoDeclipProcessor()
{
    setControllerClass(kAutoDeclipControllerUid);
}

Steinberg::tresult PLUGIN_API AutoDeclipProcessor::initialize(Steinberg::FUnknown* context)
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

void AutoDeclipProcessor::resetDsp() noexcept
{
    for (auto& channel : dsp_)
    {
        channel.reset();
    }
}

Steinberg::tresult PLUGIN_API AutoDeclipProcessor::setActive(Steinberg::TBool state)
{
    resetDsp();
    return AudioEffect::setActive(state);
}

Steinberg::tresult PLUGIN_API AutoDeclipProcessor::setupProcessing(Steinberg::Vst::ProcessSetup& setup)
{
    resetDsp();
    return AudioEffect::setupProcessing(setup);
}

Steinberg::tresult PLUGIN_API AutoDeclipProcessor::setBusArrangements(
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
    resetDsp();
    return Steinberg::kResultOk;
}

Steinberg::tresult PLUGIN_API AutoDeclipProcessor::canProcessSampleSize(Steinberg::int32 symbolicSampleSize)
{
    return symbolicSampleSize == Steinberg::Vst::kSample32 || symbolicSampleSize == Steinberg::Vst::kSample64
        ? Steinberg::kResultTrue
        : Steinberg::kResultFalse;
}

Steinberg::uint32 PLUGIN_API AutoDeclipProcessor::getLatencySamples()
{
    return static_cast<Steinberg::uint32>(Travny::Audio::AutoDeclipDsp::kLatencySamples);
}

Steinberg::uint32 PLUGIN_API AutoDeclipProcessor::getTailSamples()
{
    return static_cast<Steinberg::uint32>(Travny::Audio::AutoDeclipDsp::kLatencySamples);
}

template <typename Sample>
bool AutoDeclipProcessor::processBlock(
    Sample** input,
    Sample** output,
    Steinberg::int32 channels,
    Steinberg::int32 samples) noexcept
{
    bool allSilent = true;
    const auto channelCount = std::min<Steinberg::int32>(channels, static_cast<Steinberg::int32>(dsp_.size()));
    for (Steinberg::int32 channel = 0; channel < channelCount; ++channel)
    {
        auto* in = input[channel];
        auto* out = output[channel];
        for (Steinberg::int32 sample = 0; sample < samples; ++sample)
        {
            const auto value = dsp_[static_cast<std::size_t>(channel)].processSample(in[sample]);
            out[sample] = value;
            allSilent = allSilent && value == static_cast<Sample>(0);
        }
    }
    return allSilent;
}

Steinberg::tresult PLUGIN_API AutoDeclipProcessor::process(Steinberg::Vst::ProcessData& data)
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

    bool allSilent = false;
    if (data.symbolicSampleSize == Steinberg::Vst::kSample32)
    {
        allSilent = processBlock(data.inputs[0].channelBuffers32, data.outputs[0].channelBuffers32, channels, data.numSamples);
    }
    else if (data.symbolicSampleSize == Steinberg::Vst::kSample64)
    {
        allSilent = processBlock(data.inputs[0].channelBuffers64, data.outputs[0].channelBuffers64, channels, data.numSamples);
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
