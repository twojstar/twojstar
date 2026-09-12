#pragma once

#include "public.sdk/source/vst/vsteditcontroller.h"

namespace Travny::Vst3 {

class AutoDeclipController final : public Steinberg::Vst::EditController
{
public:
    static Steinberg::FUnknown* createInstance(void*)
    {
        return static_cast<Steinberg::Vst::IEditController*>(new AutoDeclipController());
    }

    Steinberg::tresult PLUGIN_API setComponentState(Steinberg::IBStream*) SMTG_OVERRIDE
    {
        return Steinberg::kResultOk;
    }
};

} // namespace Travny::Vst3
