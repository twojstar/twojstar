cmake_minimum_required(VERSION 3.25)

project(TravnyAudacityVst3
    VERSION 0.1.0
    DESCRIPTION "Local-first VST3 audio utilities for Audacity"
    LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Single-config generators otherwise leave Steinberg's required RELEASE/DEBUG macros undefined.
if(NOT CMAKE_CONFIGURATION_TYPES AND NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

include(CTest)

add_library(TravnyAutoDeclipDsp STATIC
    src/autodeclip/AutoDeclipDsp.cpp
    src/autodeclip/AutoDeclipDsp.h
)
target_include_directories(TravnyAutoDeclipDsp PUBLIC src/autodeclip)
target_compile_features(TravnyAutoDeclipDsp PUBLIC cxx_std_20)

add_library(TravnySmartTransitionDsp STATIC
    src/smarttransition/SmartTransitionDsp.cpp
    src/smarttransition/SmartTransitionDsp.h
)
target_include_directories(TravnySmartTransitionDsp PUBLIC src/smarttransition)
target_compile_features(TravnySmartTransitionDsp PUBLIC cxx_std_20)

if(BUILD_TESTING)
    add_executable(AutoDeclipDspTests tests/AutoDeclipDspTests.cpp)
    target_link_libraries(AutoDeclipDspTests PRIVATE TravnyAutoDeclipDsp)
    target_compile_features(AutoDeclipDspTests PRIVATE cxx_std_20)
    add_test(NAME AutoDeclipDspTests COMMAND AutoDeclipDspTests)

    add_executable(SmartTransitionDspTests tests/SmartTransitionDspTests.cpp)
    target_link_libraries(SmartTransitionDspTests PRIVATE TravnySmartTransitionDsp)
    target_compile_features(SmartTransitionDspTests PRIVATE cxx_std_20)
    add_test(NAME SmartTransitionDspTests COMMAND SmartTransitionDspTests)
endif()

set(VST3_SDK_ROOT "" CACHE PATH "Path to a local Steinberg VST3 SDK 3.8+ checkout")

if(NOT VST3_SDK_ROOT)
    message(STATUS "DSP cores configured. Set VST3_SDK_ROOT to build the Audacity VST3 adapters.")
    return()
endif()

if(NOT EXISTS "${VST3_SDK_ROOT}/CMakeLists.txt")
    message(FATAL_ERROR "VST3_SDK_ROOT must point to the root of a Steinberg VST3 SDK checkout.")
endif()

# Keep third-party examples and GUI code out of these small effect builds.
set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)

add_subdirectory("${VST3_SDK_ROOT}" "${CMAKE_BINARY_DIR}/vst3sdk" EXCLUDE_FROM_ALL)
smtg_enable_vst3_sdk()

smtg_add_vst3plugin(TravnyAutoDeclip
    src/autodeclip/AutoDeclipCids.h
    src/autodeclip/AutoDeclipController.h
    src/autodeclip/AutoDeclipEntry.cpp
    src/autodeclip/AutoDeclipProcessor.cpp
    src/autodeclip/AutoDeclipProcessor.h
)

target_include_directories(TravnyAutoDeclip PRIVATE src/autodeclip)
target_compile_features(TravnyAutoDeclip PRIVATE cxx_std_20)
target_link_libraries(TravnyAutoDeclip PRIVATE sdk TravnyAutoDeclipDsp)

smtg_add_vst3plugin(TravnySmartTransition
    src/smarttransition/SmartTransitionCids.h
    src/smarttransition/SmartTransitionController.h
    src/smarttransition/SmartTransitionEntry.cpp
    src/smarttransition/SmartTransitionProcessor.cpp
    src/smarttransition/SmartTransitionProcessor.h
)

target_include_directories(TravnySmartTransition PRIVATE src/smarttransition)
target_compile_features(TravnySmartTransition PRIVATE cxx_std_20)
target_link_libraries(TravnySmartTransition PRIVATE sdk TravnySmartTransitionDsp)
