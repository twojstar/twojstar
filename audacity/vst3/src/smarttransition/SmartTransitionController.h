#pragma once

#include "public.sdk/source/vst/vsteditcontroller.h"

namespace Travny::Vst3 {

class SmartTransitionController final : public Steinberg::Vst::EditController
{
public:
    static Steinberg::FUnknown* createInstance(void*)
    {
        return static_cast<Steinberg::Vst::IEditController*>(new SmartTransitionController());
    }

    Steinberg::tresult PLUGIN_API setComponentState(Steinberg::IBStream*) SMTG_OVERRIDE
    {
        return Steinberg::kResultOk;
    }
};

} // namespace Travny::Vst3
