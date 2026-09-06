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

set(VST3_SDK_ROOT "" CACHE PATH "Path to a local Steinberg VST3 SDK checkout")

if(NOT VST3_SDK_ROOT)
    message(STATUS "Audacity VST3 foundation only: set VST3_SDK_ROOT when the first effect target lands.")
    return()
endif()

if(NOT EXISTS "${VST3_SDK_ROOT}/CMakeLists.txt")
    message(FATAL_ERROR "VST3_SDK_ROOT must point to the root of a Steinberg VST3 SDK checkout.")
endif()

# Keep the SDK as a build dependency, not a second source tree maintained here.
set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)

add_subdirectory("${VST3_SDK_ROOT}" "${CMAKE_BINARY_DIR}/vst3sdk" EXCLUDE_FROM_ALL)
smtg_enable_vst3_sdk()

message(STATUS "VST3 SDK configured. No effect target is committed yet.")
