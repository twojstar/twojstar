#include "AutoDeclipDsp.h"

#include <cmath>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <vector>

using Travny::Audio::AutoDeclipDsp;

namespace {

void require(bool condition, const char* message)
{
    if (!condition)
    {
        throw std::runtime_error(message);
    }
}

std::vector<double> render(const std::vector<double>& input)
{
    AutoDeclipDsp dsp;
    std::vector<double> output;
    output.reserve(input.size() + AutoDeclipDsp::kLatencySamples);

    for (double sample : input)
    {
        output.push_back(dsp.processSample(sample));
    }
    for (std::size_t i = 0; i < AutoDeclipDsp::kLatencySamples; ++i)
    {
        output.push_back(dsp.processSample(0.0));
    }
    return output;
}

std::vector<double> aligned(const std::vector<double>& rendered, std::size_t originalSize)
{
    return {rendered.begin() + static_cast<std::ptrdiff_t>(AutoDeclipDsp::kLatencySamples),
            rendered.begin() + static_cast<std::ptrdiff_t>(AutoDeclipDsp::kLatencySamples + originalSize)};
}

void testCleanPassThrough()
{
    std::vector<double> input(256);
    for (std::size_t i = 0; i < input.size(); ++i)
    {
        input[i] = 0.8 * std::sin(static_cast<double>(i) * 0.07);
    }

    const auto output = aligned(render(input), input.size());
    for (std::size_t i = 0; i < input.size(); ++i)
    {
        require(std::abs(output[i] - input[i]) < 1e-12, "clean audio changed");
    }
}

void testShortPositiveClipIsRepaired()
{
    std::vector<double> input(160, 0.0);
    input[76] = 0.72;
    input[77] = 0.86;
    input[78] = 1.0;
    input[79] = 1.0;
    input[80] = 1.0;
    input[81] = 1.0;
    input[82] = 0.87;
    input[83] = 0.73;

    const auto output = aligned(render(input), input.size());
    for (std::size_t i = 78; i <= 81; ++i)
    {
        require(output[i] < 0.9995, "positive clipping plateau survived");
        require(output[i] > 0.86, "positive repair collapsed below clean edges");
    }
    require(std::abs(output[77] - input[77]) < 1e-12, "left clean edge changed");
    require(std::abs(output[82] - input[82]) < 1e-12, "right clean edge changed");
}

void testShortNegativeClipIsRepaired()
{
    std::vector<double> input(160, 0.0);
    input[76] = -0.71;
    input[77] = -0.85;
    input[78] = -1.0;
    input[79] = -1.0;
    input[80] = -1.0;
    input[81] = -0.86;
    input[82] = -0.72;

    const auto output = aligned(render(input), input.size());
    for (std::size_t i = 78; i <= 80; ++i)
    {
        require(output[i] > -0.9995, "negative clipping plateau survived");
        require(output[i] < -0.84, "negative repair collapsed above clean edges");
    }
}

void testSinglePeakIsUntouched()
{
    std::vector<double> input(140, 0.0);
    input[70] = 1.0;
    const auto output = aligned(render(input), input.size());
    require(output[70] == 1.0, "isolated full-scale sample should not be guessed away");
}

void testLongClipIsUntouched()
{
    std::vector<double> input(220, 0.0);
    for (std::size_t i = 80; i < 80 + AutoDeclipDsp::kMaxRepairSamples + 4; ++i)
    {
        input[i] = 1.0;
    }

    const auto output = aligned(render(input), input.size());
    for (std::size_t i = 80; i < 80 + AutoDeclipDsp::kMaxRepairSamples + 4; ++i)
    {
        require(output[i] == 1.0, "long clipping should be left for a stronger repair stage");
    }
}

} // namespace

int main()
{
    try
    {
        testCleanPassThrough();
        testShortPositiveClipIsRepaired();
        testShortNegativeClipIsRepaired();
        testSinglePeakIsUntouched();
        testLongClipIsUntouched();
        std::cout << "AutoDeclip DSP tests passed\n";
        return EXIT_SUCCESS;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return EXIT_FAILURE;
    }
}
