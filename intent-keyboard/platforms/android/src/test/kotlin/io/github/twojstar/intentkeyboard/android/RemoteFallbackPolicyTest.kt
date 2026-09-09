package io.github.twojstar.intentkeyboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteFallbackPolicyTest {
    @Test
    fun noLocalAndNoRemoteUsesMechanicalWithoutUploadWarning() {
        val plan = RemoteFallbackPolicy.withoutLocal(remoteAvailable = false)
        val mechanical = plan as RemoteFallbackPlan.Mechanical

        assertNull(mechanical.warning)
    }

    @Test
    fun noLocalRemoteSuccessAndFailureUseDifferentDisclosureStrength() {
        val plan = RemoteFallbackPolicy.withoutLocal(remoteAvailable = true)
        val remote = plan as RemoteFallbackPlan.TryRemote

        assertEquals("Remote fallback used; draft text left this device.", remote.successWarning)
        assertTrue("attempted" in remote.failureWarning)
        assertTrue("may have left" in remote.failureWarning)
    }

    @Test
    fun localFailureWithoutRemoteExplainsMechanicalFallback() {
        val plan = RemoteFallbackPolicy.afterLocalFailure(remoteAvailable = false)
        val mechanical = plan as RemoteFallbackPlan.Mechanical

        assertEquals("Local rendering failed; mechanical fallback used.", mechanical.warning)
    }

    @Test
    fun localThenRemotePathDisclosesBothStages() {
        val plan = RemoteFallbackPolicy.afterLocalFailure(remoteAvailable = true)
        val remote = plan as RemoteFallbackPlan.TryRemote

        assertTrue(remote.successWarning.startsWith("Local render failed; remote fallback used."))
        assertTrue("Draft text left this device." in remote.successWarning)
        assertTrue(remote.failureWarning.startsWith("Local and remote rendering failed;"))
        assertTrue("Remote request was attempted" in remote.failureWarning)
        assertTrue("draft may have left this device" in remote.failureWarning)
    }
}
