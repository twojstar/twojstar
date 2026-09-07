#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace Travny::Audio {

enum class SmartFadeCurve : std::uint8_t
{
    None = 0,
    SCurve = 1,
};

enum class SmartRepairMode : std::uint8_t
{
    None = 0,
};

struct SmartEditPlan
{
    std::uint32_t schemaVersion{1};
    std::int64_t seamAnchorSamples{0};
    double confidence{0.0};
    std::uint8_t affectedChannelsMask{0};
    double leftGainDb{0.0};
    double rightGainDb{0.0};
    double dcDelta{0.0};
    std::int32_t timingOffsetSamples{0};
    std::int32_t fadeLengthSamples{0};
    SmartFadeCurve fadeCurve{SmartFadeCurve::None};
    SmartRepairMode repairMode{SmartRepairMode::None};
    std::int32_t repairStartOffsetSamples{0};
    std::int32_t repairLengthSamples{0};
    bool noOp{true};
};

class SmartTransitionDsp final
{
public:
    static constexpr std::size_t kMaxChannels = 2;
    static constexpr std::size_t kMinLookaheadSamples = 1024;
    static constexpr std::size_t kMaxLookaheadSamples = 8192;
    static constexpr std::size_t kRingCapacity = 16384;
    static constexpr std::size_t kMinAnalysisRadiusSamples = 16;
    static constexpr std::size_t kMinFadeLengthSamples = 16;
    static constexpr std::int64_t kScoreScale = 1'000'000;

    SmartTransitionDsp() noexcept;

    void configure(double sampleRate) noexcept;
    void reset() noexcept;

    [[nodiscard]] std::size_t latencySamples() const noexcept { return lookaheadSamples_; }
    [[nodiscard]] bool hasPlan() const noexcept { return planCommitted_; }
    [[nodiscard]] const SmartEditPlan& plan() const noexcept { return plan_; }
    [[nodiscard]] std::int64_t planWindowStartSamples() const noexcept { return planWindowStart_; }

    void processFrame(const double* input, double* output, std::size_t channels) noexcept;
    void drainFrame(double* output, std::size_t channels) noexcept;

private:
    struct Candidate
    {
        std::int64_t anchor{0};
        std::int64_t scoreKey{0};
        double confidence{0.0};
        std::uint8_t affectedChannelsMask{0};
        double leftMean{0.0};
        double rightMean{0.0};
        double leftRms{0.0};
        double rightRms{0.0};
        std::size_t analysisRadius{0};
        bool valid{false};
    };

    void processFrameInternal(const double* input, double* output, std::size_t channels, bool analyze) noexcept;
    void storeFrame(const double* input, std::size_t channels, std::int64_t index) noexcept;
    [[nodiscard]] double sampleAt(std::size_t channel, std::int64_t index) const noexcept;
    [[nodiscard]] Candidate scoreCandidate(
        std::int64_t anchor,
        std::size_t channels,
        std::size_t radius) const noexcept;
    void considerCandidate(const Candidate& candidate, std::int64_t currentInputIndex) noexcept;
    void scanShortSelection(std::size_t channels) noexcept;
    void finalizeCluster(std::int64_t currentInputIndex) noexcept;
    [[nodiscard]] SmartEditPlan makePlan(const Candidate& candidate, std::size_t fadeLength) const noexcept;
    [[nodiscard]] double renderSample(std::size_t channel, std::int64_t outputIndex) const noexcept;

    std::array<std::array<double, kRingCapacity>, kMaxChannels> ring_{};
    std::int64_t inputCount_{0};
    double sampleRate_{48000.0};
    std::size_t lookaheadSamples_{4800};
    std::size_t analysisRadius_{48};
    std::size_t fadeLengthSamples_{192};
    std::size_t competitionRadius_{192};
    bool drainStarted_{false};

    Candidate clusterBest_{};
    bool clusterActive_{false};
    SmartEditPlan plan_{};
    bool planCommitted_{false};
    std::int64_t committedAnchor_{-1};
    std::int64_t planWindowStart_{0};
};

} // namespace Travny::Audio
