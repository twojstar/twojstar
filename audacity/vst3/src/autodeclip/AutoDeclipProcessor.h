#pragma once

#include "AutoDeclipCids.h"
#include "AutoDeclipDsp.h"
#include "public.sdk/source/vst/vstaudioeffect.h"

#include <array>

namespace Travny::Vst3 {

class AutoDeclipProcessor final : public Steinberg::Vst::AudioEffect
{
public:
    AutoDeclipProcessor();

    static Steinberg::FUnknown* createInstance(void*)
    {
        return static_cast<Steinberg::Vst::IAudioProcessor*>(new AutoDeclipProcessor());
    }

    Steinberg::tresult PLUGIN_API initialize(Steinberg::FUnknown* context) SMTG_OVERRIDE;
    Steinberg::tresult PLUGIN_API setActive(Steinberg::TBool state) SMTG_OVERRIDE;
    Steinberg::tresult PLUGIN_API setupProcessing(Steinberg::Vst::ProcessSetup& setup) SMTG_OVERRIDE;
    Steinberg::tresult PLUGIN_API setBusArrangements(
        Steinberg::Vst::SpeakerArrangement* inputs,
        Steinberg::int32 numIns,
        Steinberg::Vst::SpeakerArrangement* outputs,
        Steinberg::int32 numOuts) SMTG_OVERRIDE;
    Steinberg::tresult PLUGIN_API canProcessSampleSize(Steinberg::int32 symbolicSampleSize) SMTG_OVERRIDE;
    Steinberg::uint32 PLUGIN_API getLatencySamples() SMTG_OVERRIDE;
    Steinberg::uint32 PLUGIN_API getTailSamples() SMTG_OVERRIDE;
    Steinberg::tresult PLUGIN_API process(Steinberg::Vst::ProcessData& data) SMTG_OVERRIDE;
    Steinberg::tresult PLUGIN_API setState(Steinberg::IBStream*) SMTG_OVERRIDE { return Steinberg::kResultOk; }
    Steinberg::tresult PLUGIN_API getState(Steinberg::IBStream*) SMTG_OVERRIDE { return Steinberg::kResultOk; }

private:
    void resetDsp() noexcept;

    template <typename Sample>
    void processBlock(Sample** input, Sample** output, Steinberg::int32 channels, Steinberg::int32 samples) noexcept;

    std::array<Travny::Audio::AutoDeclipDsp, 2> dsp_{};
};

} // namespace Travny::Vst3
