#include "AutoDeclipCids.h"
#include "AutoDeclipController.h"
#include "AutoDeclipProcessor.h"

#include "pluginterfaces/vst/vsttypes.h"
#include "public.sdk/source/main/pluginfactory.h"

using namespace Steinberg;
using namespace Steinberg::Vst;

BEGIN_FACTORY_DEF("Travny", "https://github.com/twojstar/twojstar", "")

    DEF_CLASS2(INLINE_UID_FROM_FUID(Travny::Vst3::kAutoDeclipProcessorUid),
               PClassInfo::kManyInstances,
               kVstAudioEffectClass,
               "Travny Auto Declip",
               Vst::kDistributable,
               Vst::PlugType::kFxRestoration,
               "0.1.0",
               kVstVersionString,
               Travny::Vst3::AutoDeclipProcessor::createInstance)

    DEF_CLASS2(INLINE_UID_FROM_FUID(Travny::Vst3::kAutoDeclipControllerUid),
               PClassInfo::kManyInstances,
               kVstComponentControllerClass,
               "Travny Auto Declip Controller",
               0,
               "",
               "0.1.0",
               kVstVersionString,
               Travny::Vst3::AutoDeclipController::createInstance)

END_FACTORY
