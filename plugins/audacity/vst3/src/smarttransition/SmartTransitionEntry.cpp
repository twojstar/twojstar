#include "SmartTransitionCids.h"
#include "SmartTransitionController.h"
#include "SmartTransitionProcessor.h"

#include "pluginterfaces/vst/vsttypes.h"
#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;

BEGIN_FACTORY_DEF("Travny", "https://github.com/twojstar/twojstar", "")

    DEF_CLASS2(INLINE_UID_FROM_FUID(Travny::Vst3::kSmartTransitionProcessorUid),
               PClassInfo::kManyInstances,
               kVstAudioEffectClass,
               "Travny Smart Transition",
               Vst::kDistributable,
               Vst::PlugType::kFxRestoration,
               "0.1.0",
               kVstVersionString,
               Travny::Vst3::SmartTransitionProcessor::createInstance)

    DEF_CLASS2(INLINE_UID_FROM_FUID(Travny::Vst3::kSmartTransitionControllerUid),
               PClassInfo::kManyInstances,
               kVstComponentControllerClass,
               "Travny Smart Transition Controller",
               0,
               "",
               "0.1.0",
               kVstVersionString,
               Travny::Vst3::SmartTransitionController::createInstance)

END_FACTORY
