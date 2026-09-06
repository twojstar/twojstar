#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace Travny::Audio {

class AutoDeclipDsp final
{
public:
    static constexpr std::size_t kLatencySamples = 64;
    static constexpr std::size_t kMaxRepairSamples = 32;
    static constexpr double kClipThreshold = 0.995;

    AutoDeclipDsp() noexcept { reset(); }

    void reset() noexcept;

    template <typename Sample>
    Sample processSample(Sample input) noexcept
    {
        return static_cast<Sample>(processSampleImpl(static_cast<double>(input)));
    }

private:
    static constexpr std::size_t kBufferSize = 128;

    double processSampleImpl(double input) noexcept;
    void repairPendingRun(std::uint64_t rightContextIndex) noexcept;
    double sampleAt(std::uint64_t index) const noexcept;
    double& sampleAt(std::uint64_t index) noexcept;

    std::array<double, kBufferSize> buffer_{};
    std::uint64_t nextIndex_ = 0;
    std::uint64_t clipStart_ = 0;
    std::uint64_t pendingStart_ = 0;
    std::uint64_t pendingEnd_ = 0;
    bool inClip_ = false;
    bool repairPending_ = false;
};

} // namespace Travny::Audio
