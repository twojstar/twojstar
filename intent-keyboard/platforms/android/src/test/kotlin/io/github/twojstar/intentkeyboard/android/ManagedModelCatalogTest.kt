package io.github.twojstar.intentkeyboard.android

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ManagedModelCatalogTest {
    @Test
    fun recommendedModelKeepsPinnedArtifactContract() {
        val spec = ManagedModelCatalog.recommended

        assertTrue(SAFE_ID.matches(spec.id))
        assertTrue(spec.displayName.endsWith(".litertlm", ignoreCase = true))
        assertTrue(spec.licenseName.isNotBlank())
        assertTrue(spec.sizeBytes > 0L)
        assertTrue(SHA256.matches(spec.sha256))

        val download = URI(spec.downloadUrl)
        val source = URI(spec.sourceUrl)
        assertHttps(download)
        assertHttps(source)
        assertEquals(download.host, source.host)

        val downloadRevision = pathSegmentAfter(download, "resolve")
        val sourceRevision = pathSegmentAfter(source, "tree")
        assertEquals(sourceRevision, downloadRevision)
        assertTrue(GIT_REVISION.matches(downloadRevision))
    }

    private fun assertHttps(uri: URI) {
        assertEquals("https", uri.scheme.lowercase())
        assertFalse(uri.host.isNullOrBlank())
        assertTrue(uri.userInfo == null)
    }

    private fun pathSegmentAfter(uri: URI, marker: String): String {
        val segments = uri.path.split('/').filter { it.isNotBlank() }
        val markerIndex = segments.indexOf(marker)
        assertTrue("Missing $marker segment in $uri", markerIndex >= 0 && markerIndex + 1 < segments.size)
        return segments[markerIndex + 1]
    }

    private companion object {
        val SAFE_ID = Regex("[A-Za-z0-9][A-Za-z0-9._-]*")
        val SHA256 = Regex("[0-9a-f]{64}")
        val GIT_REVISION = Regex("[0-9a-f]{40}")
    }
}
