package io.github.twojstar.intentkeyboard

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

class RecipientProfileTest {
    @Test
    fun recipientProfileAddsTrustedRenderContextWithoutChangingInputEnvelope() {
        val raw = "jutro nie dam rady, wysle rano"
        val prompt = SemanticPromptCompiler.compile(
            RenderRequest(
                rawIntent = raw,
                register = Register.CIVILIZED,
                recipientProfile = RecipientProfile.CLIENT,
            ),
        )

        assertTrue("Write for a client" in prompt.instructions)

        val envelope = Json.parseToJsonElement(prompt.input) as JsonObject
        assertEquals(raw, envelope["message"]?.jsonPrimitive?.content)
        assertFalse("recipientProfile" in envelope)
    }

    @Test
    fun mechanicalFallbackWarnsWhenRecipientContextCannotBeApplied() = runTest {
        val result = SemanticPipeline(MechanicalRenderer()).render(
            RenderRequest(
                rawIntent = "hej jutro",
                recipientProfile = RecipientProfile.FRIEND,
            ),
        )

        assertTrue(result.warnings.any { "recipient context" in it })
    }
}
