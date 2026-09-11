package io.github.twojstar.intentkeyboard.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ManagedModelInstallProgressTest {
    @Test
    fun downloadAndVerificationPhasesRemainCancellable() {
        assertTrue(ManagedModelInstallProgress.Connecting.isCancellable())
        assertTrue(
            ManagedModelInstallProgress.Downloading(
                downloadedBytes = 1,
                totalBytes = 2,
            ).isCancellable(),
        )
        assertTrue(ManagedModelInstallProgress.Verifying.isCancellable())
    }

    @Test
    fun testingAndActivationPhasesCannotBeCancelled() {
        assertFalse(ManagedModelInstallProgress.Testing.isCancellable())
        assertFalse(ManagedModelInstallProgress.Activating.isCancellable())
    }
}
