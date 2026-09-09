package io.github.twojstar.intentkeyboard.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import io.github.twojstar.intentkeyboard.BearerTokenProvider
import io.github.twojstar.intentkeyboard.OpenAiCompatibleConfig
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class RemoteProviderSettings(
    val enabled: Boolean = false,
    val baseUrl: String = "",
    val model: String = "",
    val hasToken: Boolean = false,
) {
    fun configOrNull(): OpenAiCompatibleConfig? {
        if (!enabled) return null
        return runCatching { OpenAiCompatibleConfig(baseUrl = baseUrl, model = model) }.getOrNull()
    }
}

class RemoteProviderStore(context: Context) : BearerTokenProvider {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    fun current(): RemoteProviderSettings = RemoteProviderSettings(
        enabled = preferences.getBoolean(KEY_ENABLED, false),
        baseUrl = preferences.getString(KEY_BASE_URL, "").orEmpty(),
        model = preferences.getString(KEY_MODEL, "").orEmpty(),
        hasToken = preferences.contains(KEY_TOKEN_CIPHERTEXT) && preferences.contains(KEY_TOKEN_IV),
    )

    fun save(enabled: Boolean, baseUrl: String, model: String, token: String? = null) {
        val normalizedBaseUrl = baseUrl.trim().trimEnd('/')
        val normalizedModel = model.trim()
        if (enabled) {
            OpenAiCompatibleConfig(baseUrl = normalizedBaseUrl, model = normalizedModel)
        }

        val encryptedToken = token
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.let(::encrypt)

        preferences.edit().apply {
            putBoolean(KEY_ENABLED, enabled)
            putString(KEY_BASE_URL, normalizedBaseUrl)
            putString(KEY_MODEL, normalizedModel)
            if (encryptedToken != null) {
                putString(KEY_TOKEN_CIPHERTEXT, encryptedToken.ciphertext)
                putString(KEY_TOKEN_IV, encryptedToken.iv)
            }
        }.apply()
    }

    fun clearToken() {
        preferences.edit()
            .remove(KEY_TOKEN_CIPHERTEXT)
            .remove(KEY_TOKEN_IV)
            .apply()
    }

    override suspend fun token(): String? {
        val ciphertext = preferences.getString(KEY_TOKEN_CIPHERTEXT, null) ?: return null
        val iv = preferences.getString(KEY_TOKEN_IV, null) ?: return null
        return try {
            decrypt(EncryptedToken(ciphertext = ciphertext, iv = iv))
        } catch (_: GeneralSecurityException) {
            null
        } catch (_: IOException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private fun encrypt(token: String): EncryptedToken = try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        EncryptedToken(
            ciphertext = Base64.encodeToString(
                cipher.doFinal(token.toByteArray(Charsets.UTF_8)),
                Base64.NO_WRAP,
            ),
            iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
        )
    } catch (error: GeneralSecurityException) {
        throw RemoteProviderStoreException("Could not encrypt the provider token.", error)
    } catch (error: IOException) {
        throw RemoteProviderStoreException("Could not access Android Keystore.", error)
    }

    private fun decrypt(token: EncryptedToken): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        val iv = Base64.decode(token.iv, Base64.NO_WRAP)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        val plaintext = cipher.doFinal(Base64.decode(token.ciphertext, Base64.NO_WRAP))
        return plaintext.toString(Charsets.UTF_8)
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            generateKey()
        }
    }

    private data class EncryptedToken(
        val ciphertext: String,
        val iv: String,
    )

    private companion object {
        const val PREFERENCES_NAME = "intent_keyboard_remote_provider"
        const val KEY_ENABLED = "enabled"
        const val KEY_BASE_URL = "base_url"
        const val KEY_MODEL = "model"
        const val KEY_TOKEN_CIPHERTEXT = "token_ciphertext"
        const val KEY_TOKEN_IV = "token_iv"
        const val KEY_ALIAS = "intent_keyboard_remote_provider_token"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
    }
}

class RemoteProviderStoreException(message: String, cause: Throwable) : Exception(message, cause)
