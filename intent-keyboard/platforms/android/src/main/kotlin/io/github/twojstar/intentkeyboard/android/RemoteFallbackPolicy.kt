package io.github.twojstar.intentkeyboard.android

internal sealed interface RemoteFallbackPlan {
    data class Mechanical(
        val warning: String?,
    ) : RemoteFallbackPlan

    data class TryRemote(
        val successWarning: String,
        val failureWarning: String,
    ) : RemoteFallbackPlan
}

internal object RemoteFallbackPolicy {
    fun withoutLocal(remoteAvailable: Boolean): RemoteFallbackPlan =
        if (remoteAvailable) {
            RemoteFallbackPlan.TryRemote(
                successWarning = "Remote fallback used; draft text left this device.",
                failureWarning =
                    "Remote provider failed; mechanical fallback used. " +
                        "Remote request was attempted; draft may have left this device.",
            )
        } else {
            RemoteFallbackPlan.Mechanical(warning = null)
        }

    fun afterLocalFailure(remoteAvailable: Boolean): RemoteFallbackPlan =
        if (remoteAvailable) {
            RemoteFallbackPlan.TryRemote(
                successWarning =
                    "Local render failed; remote fallback used. Draft text left this device.",
                failureWarning =
                    "Local and remote rendering failed; mechanical fallback used. " +
                        "Remote request was attempted; draft may have left this device.",
            )
        } else {
            RemoteFallbackPlan.Mechanical(
                warning = "Local rendering failed; mechanical fallback used.",
            )
        }
}
