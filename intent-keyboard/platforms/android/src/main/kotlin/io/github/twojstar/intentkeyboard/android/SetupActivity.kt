package io.github.twojstar.intentkeyboard.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.text.format.Formatter
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.github.twojstar.intentkeyboard.RecipientProfile
import io.github.twojstar.intentkeyboard.Tone
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@Suppress("DEPRECATION")
class SetupActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val modelStore by lazy(LazyThreadSafetyMode.NONE) {
        LocalModelStore(applicationContext)
    }
    private val renderPreferenceStore by lazy(LazyThreadSafetyMode.NONE) {
        RenderPreferenceStore(applicationContext)
    }
    private val remoteProviderStore by lazy(LazyThreadSafetyMode.NONE) {
        RemoteProviderStore(applicationContext)
    }
    private val managedInstallCoordinator by lazy(LazyThreadSafetyMode.NONE) {
        ManagedModelInstallCoordinator.get(applicationContext)
    }

    private val managedStateListener: (ManagedModelInstallState) -> Unit = { state ->
        renderManagedInstallState(state)
    }

    private var manualModelOperationInProgress = false
    private var modelStatusView: TextView? = null
    private var installRecommendedModelButton: Button? = null
    private var importModelButton: Button? = null
    private var clearModelButton: Button? = null
    private var toneButton: Button? = null
    private var recipientProfileButton: Button? = null
    private var sourceLanguageButton: Button? = null
    private var targetLanguageButton: Button? = null
    private var remoteEnabledCheckBox: CheckBox? = null
    private var remoteBaseUrlInput: EditText? = null
    private var remoteModelInput: EditText? = null
    private var remoteTokenInput: EditText? = null
    private var remoteStatusView: TextView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val recommended = ManagedModelCatalog.recommended
        val recommendedSize = Formatter.formatFileSize(this, recommended.sizeBytes)

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(32), dp(24), dp(32))

            addView(TextView(context).apply {
                text = getString(R.string.setup_title)
                textSize = 24f
            })

            addView(TextView(context).apply {
                text = getString(R.string.setup_body)
                textSize = 16f
                setPadding(0, dp(16), 0, dp(24))
            })

            addView(TextView(context).apply {
                text = getString(R.string.local_model_title)
                textSize = 18f
            }, matchWidth())

            modelStatusView = TextView(context).also { view ->
                view.textSize = 14f
                view.setPadding(0, dp(8), 0, dp(12))
                addView(view, matchWidth())
            }

            addView(TextView(context).apply {
                text = getString(R.string.recommended_model_summary, recommendedSize)
                textSize = 14f
                setPadding(0, 0, 0, dp(8))
            }, matchWidth())

            installRecommendedModelButton = Button(context).also { button ->
                button.isAllCaps = false
                button.setOnClickListener { toggleManagedModelInstall() }
                addView(button, matchWidth())
            }

            addView(Button(context).apply {
                text = getString(R.string.model_source_license)
                isAllCaps = false
                setOnClickListener { openManagedModelSource() }
            }, matchWidth())

            importModelButton = Button(context).also { button ->
                button.text = getString(R.string.import_local_model)
                button.isAllCaps = false
                button.setOnClickListener { openModelPicker() }
                addView(button, matchWidth())
            }

            clearModelButton = Button(context).also { button ->
                button.text = getString(R.string.clear_local_model)
                button.isAllCaps = false
                button.setOnClickListener { clearLocalModel() }
                addView(button, matchWidth())
            }

            addSemanticOutputSettings()
            addRemoteProviderSettings()

            addView(TextView(context).apply {
                text = getString(R.string.keyboard_setup_title)
                textSize = 18f
                setPadding(0, dp(24), 0, dp(8))
            }, matchWidth())

            addView(Button(context).apply {
                text = getString(R.string.open_keyboard_settings)
                setOnClickListener {
                    startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
                }
            }, matchWidth())

            addView(Button(context).apply {
                text = getString(R.string.choose_keyboard)
                setOnClickListener {
                    val manager = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                    manager.showInputMethodPicker()
                }
            }, matchWidth())
        }

        val root = ScrollView(this).apply {
            isFillViewport = true
            addView(
                content,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
        }

        setContentView(
            root,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )

        refreshModelStatus()
        updateModelControls()
        refreshRenderSettings()
        refreshRemoteProviderSettings()
    }

    private fun LinearLayout.addSemanticOutputSettings() {
        addView(TextView(context).apply {
            text = getString(R.string.semantic_output_title)
            textSize = 18f
            setPadding(0, dp(24), 0, dp(8))
        }, matchWidth())

        addView(TextView(context).apply {
            text = getString(R.string.semantic_output_summary)
            textSize = 14f
            setPadding(0, 0, 0, dp(8))
        }, matchWidth())

        toneButton = Button(context).also { button ->
            button.isAllCaps = false
            button.setOnClickListener { cycleTone() }
            addView(button, matchWidth())
        }

        recipientProfileButton = Button(context).also { button ->
            button.isAllCaps = false
            button.setOnClickListener { cycleRecipientProfile() }
            addView(button, matchWidth())
        }

        sourceLanguageButton = Button(context).also { button ->
            button.isAllCaps = false
            button.setOnClickListener { cycleSourceLanguage() }
            addView(button, matchWidth())
        }

        targetLanguageButton = Button(context).also { button ->
            button.isAllCaps = false
            button.setOnClickListener { cycleTargetLanguage() }
            addView(button, matchWidth())
        }
    }

    private fun LinearLayout.addRemoteProviderSettings() {
        addView(TextView(context).apply {
            text = getString(R.string.remote_provider_title)
            textSize = 18f
            setPadding(0, dp(24), 0, dp(8))
        }, matchWidth())

        addView(TextView(context).apply {
            text = getString(R.string.remote_provider_summary)
            textSize = 14f
            setPadding(0, 0, 0, dp(8))
        }, matchWidth())

        remoteEnabledCheckBox = CheckBox(context).also { checkBox ->
            checkBox.text = getString(R.string.remote_provider_enable)
            addView(checkBox, matchWidth())
        }

        remoteBaseUrlInput = EditText(context).also { input ->
            input.hint = getString(R.string.remote_provider_base_url_hint)
            input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            input.setSingleLine(true)
            addView(input, matchWidth())
        }

        remoteModelInput = EditText(context).also { input ->
            input.hint = getString(R.string.remote_provider_model_hint)
            input.setSingleLine(true)
            addView(input, matchWidth())
        }

        remoteTokenInput = EditText(context).also { input ->
            input.hint = getString(R.string.remote_provider_token_hint)
            input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            input.setSingleLine(true)
            addView(input, matchWidth())
        }

        addView(Button(context).apply {
            text = getString(R.string.remote_provider_save)
            isAllCaps = false
            setOnClickListener { saveRemoteProviderSettings() }
        }, matchWidth())

        addView(Button(context).apply {
            text = getString(R.string.remote_provider_clear_token)
            isAllCaps = false
            setOnClickListener { clearRemoteProviderToken() }
        }, matchWidth())

        remoteStatusView = TextView(context).also { view ->
            view.textSize = 13f
            view.setPadding(0, dp(8), 0, 0)
            addView(view, matchWidth())
        }
    }

    override fun onStart() {
        super.onStart()
        managedInstallCoordinator.addListener(managedStateListener)
    }

    override fun onResume() {
        super.onResume()
        val managedState = managedInstallCoordinator.state
        if (
            !manualModelOperationInProgress &&
            (managedState is ManagedModelInstallState.Idle || managedState is ManagedModelInstallState.Completed)
        ) {
            refreshModelStatus()
            updateModelControls()
        }
        refreshRenderSettings()
        refreshRemoteProviderSettings()
    }

    override fun onStop() {
        managedInstallCoordinator.removeListener(managedStateListener)
        super.onStop()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_LOCAL_MODEL || resultCode != RESULT_OK) return

        data?.data?.let(::importLocalModel)
    }

    private fun toggleManagedModelInstall() {
        when (val state = managedInstallCoordinator.state) {
            is ManagedModelInstallState.Running -> {
                if (state.progress.isCancellable()) {
                    managedInstallCoordinator.cancel()
                }
            }
            else -> if (!isRecommendedModelInstalled()) {
                managedInstallCoordinator.start()
            }
        }
    }

    private fun renderManagedInstallState(state: ManagedModelInstallState) {
        when (state) {
            ManagedModelInstallState.Idle -> refreshModelStatus()
            is ManagedModelInstallState.Running -> showManagedInstallProgress(state.progress)
            is ManagedModelInstallState.Completed -> refreshModelStatus()
            ManagedModelInstallState.Cancelled -> {
                modelStatusView?.text = getString(R.string.model_download_cancelled)
            }
            is ManagedModelInstallState.Failed -> {
                Log.e(TAG, "Managed offline model installation failed", state.cause)
                modelStatusView?.text = state.message.ifBlank {
                    getString(R.string.model_download_failed)
                }
            }
        }
        updateModelControls()
    }

    private fun showManagedInstallProgress(progress: ManagedModelInstallProgress) {
        modelStatusView?.text = when (progress) {
            ManagedModelInstallProgress.Connecting -> getString(R.string.model_download_connecting)
            is ManagedModelInstallProgress.Downloading -> {
                val percent = if (progress.totalBytes > 0L) {
                    ((progress.downloadedBytes * 100L) / progress.totalBytes)
                        .coerceIn(0L, 100L)
                        .toInt()
                } else {
                    0
                }
                getString(
                    R.string.model_download_progress,
                    percent,
                    Formatter.formatFileSize(this, progress.downloadedBytes),
                    Formatter.formatFileSize(this, progress.totalBytes),
                )
            }
            ManagedModelInstallProgress.Verifying -> getString(R.string.model_download_verifying)
            ManagedModelInstallProgress.Testing -> getString(R.string.model_download_testing)
            ManagedModelInstallProgress.Activating -> getString(R.string.model_download_activating)
        }
    }

    private fun openManagedModelSource() {
        try {
            startActivity(
                Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse(ManagedModelCatalog.recommended.sourceUrl),
                ),
            )
        } catch (error: ActivityNotFoundException) {
            Log.w(TAG, "No activity can open the managed model source", error)
            modelStatusView?.text = getString(R.string.model_source_open_failed)
        }
    }

    private fun openModelPicker() {
        startActivityForResult(
            Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            },
            REQUEST_LOCAL_MODEL,
        )
    }

    private fun importLocalModel(uri: Uri) {
        manualModelOperationInProgress = true
        updateModelControls()
        modelStatusView?.text = getString(R.string.importing_local_model)

        scope.launch {
            try {
                modelStore.importModel(uri)
                refreshModelStatus()
            } catch (error: CancellationException) {
                throw error
            } catch (error: LocalModelStoreException) {
                Log.e(TAG, "Local model import failed", error)
                modelStatusView?.text = error.message ?: getString(R.string.local_model_import_failed)
            } finally {
                manualModelOperationInProgress = false
                updateModelControls()
            }
        }
    }

    private fun clearLocalModel() {
        manualModelOperationInProgress = true
        updateModelControls()

        scope.launch {
            try {
                modelStore.clearModel()
                refreshModelStatus()
            } catch (error: CancellationException) {
                throw error
            } catch (error: LocalModelStoreException) {
                Log.e(TAG, "Local model clear failed", error)
                modelStatusView?.text = error.message ?: getString(R.string.local_model_clear_failed)
            } finally {
                manualModelOperationInProgress = false
                updateModelControls()
            }
        }
    }

    private fun refreshModelStatus() {
        val selection = modelStore.current()
        modelStatusView?.text = if (selection == null) {
            getString(R.string.local_model_none)
        } else {
            val size = if (selection.sizeBytes >= 0L) {
                Formatter.formatFileSize(this, selection.sizeBytes)
            } else {
                getString(R.string.local_model_size_unknown)
            }
            getString(R.string.local_model_selected, selection.displayName, size)
        }
    }

    private fun updateModelControls() {
        val runningState = managedInstallCoordinator.state as? ManagedModelInstallState.Running
        val managedRunning = runningState != null
        val nonCancellablePhase = runningState?.progress?.let { !it.isCancellable() } == true
        val selection = modelStore.current()
        val recommendedInstalled = isRecommendedModelInstalled()

        installRecommendedModelButton?.apply {
            text = when {
                runningState?.progress == ManagedModelInstallProgress.Testing ->
                    getString(R.string.model_download_testing)
                runningState?.progress == ManagedModelInstallProgress.Activating ->
                    getString(R.string.model_download_activating)
                managedRunning -> getString(R.string.cancel_model_download)
                recommendedInstalled -> getString(R.string.recommended_model_installed)
                else -> getString(R.string.install_recommended_model)
            }
            isEnabled = when {
                nonCancellablePhase -> false
                managedRunning -> true
                else -> !manualModelOperationInProgress && !recommendedInstalled
            }
        }

        importModelButton?.isEnabled = !manualModelOperationInProgress && !managedRunning
        clearModelButton?.isEnabled =
            !manualModelOperationInProgress && !managedRunning && selection != null
    }

    private fun cycleTone() {
        val next = when (renderPreferenceStore.current().tone) {
            Tone.DEFAULT -> Tone.FRIENDLY
            Tone.FRIENDLY -> Tone.NEUTRAL
            Tone.NEUTRAL -> Tone.WORK
            Tone.WORK -> Tone.FORMAL
            Tone.FORMAL -> Tone.DEFAULT
        }
        renderPreferenceStore.setTone(next)
        refreshRenderSettings()
    }

    private fun cycleRecipientProfile() {
        val next = when (renderPreferenceStore.current().recipientProfile) {
            RecipientProfile.NONE -> RecipientProfile.FRIEND
            RecipientProfile.FRIEND -> RecipientProfile.WORK
            RecipientProfile.WORK -> RecipientProfile.CLIENT
            RecipientProfile.CLIENT -> RecipientProfile.FORMAL_OFFICE
            RecipientProfile.FORMAL_OFFICE -> RecipientProfile.NONE
        }
        renderPreferenceStore.setRecipientProfile(next)
        refreshRenderSettings()
    }

    private fun cycleSourceLanguage() {
        val current = renderPreferenceStore.current().sourceLanguage
        renderPreferenceStore.setSourceLanguage(nextLanguage(current))
        refreshRenderSettings()
    }

    private fun cycleTargetLanguage() {
        val current = renderPreferenceStore.current().targetLanguage
        renderPreferenceStore.setTargetLanguage(nextLanguage(current))
        refreshRenderSettings()
    }

    private fun nextLanguage(current: String?): String? = when (current) {
        null -> LANGUAGE_POLISH
        LANGUAGE_POLISH -> LANGUAGE_ENGLISH
        else -> null
    }

    private fun refreshRenderSettings() {
        val preferences = renderPreferenceStore.current()
        val tone = preferences.tone.name.lowercase().replaceFirstChar { it.titlecase() }
        toneButton?.text = getString(R.string.semantic_tone, tone)
        recipientProfileButton?.text = getString(
            R.string.semantic_recipient_profile,
            recipientProfileLabel(preferences.recipientProfile),
        )
        sourceLanguageButton?.text = getString(
            R.string.semantic_source_language,
            languageLabel(preferences.sourceLanguage, R.string.language_auto),
        )
        targetLanguageButton?.text = getString(
            R.string.semantic_target_language,
            languageLabel(preferences.targetLanguage, R.string.language_same),
        )
    }

    private fun saveRemoteProviderSettings() {
        val enabled = remoteEnabledCheckBox?.isChecked == true
        val baseUrl = remoteBaseUrlInput?.text?.toString().orEmpty()
        val model = remoteModelInput?.text?.toString().orEmpty()
        val newToken = remoteTokenInput?.text?.toString()?.takeIf { it.isNotBlank() }

        try {
            remoteProviderStore.save(
                enabled = enabled,
                baseUrl = baseUrl,
                model = model,
                token = newToken,
            )
            remoteTokenInput?.text?.clear()
            refreshRemoteProviderSettings()
        } catch (error: IllegalArgumentException) {
            remoteStatusView?.text = getString(
                R.string.remote_provider_invalid,
                error.message ?: getString(R.string.remote_provider_invalid_generic),
            )
        } catch (error: RemoteProviderStoreException) {
            Log.e(TAG, "Remote provider credential storage failed", error)
            remoteStatusView?.text = getString(R.string.remote_provider_store_failed)
        }
    }

    private fun clearRemoteProviderToken() {
        remoteProviderStore.clearToken()
        remoteTokenInput?.text?.clear()
        refreshRemoteProviderSettings()
    }

    private fun refreshRemoteProviderSettings() {
        val settings = remoteProviderStore.current()
        remoteEnabledCheckBox?.isChecked = settings.enabled
        remoteBaseUrlInput?.setText(settings.baseUrl)
        remoteModelInput?.setText(settings.model)
        remoteTokenInput?.apply {
            text?.clear()
            hint = getString(
                if (settings.hasToken) {
                    R.string.remote_provider_token_stored_hint
                } else {
                    R.string.remote_provider_token_hint
                },
            )
        }

        remoteStatusView?.text = if (settings.enabled) {
            getString(
                R.string.remote_provider_enabled_status,
                settings.model.ifBlank { getString(R.string.remote_provider_unknown_model) },
                getString(
                    if (settings.hasToken) {
                        R.string.remote_provider_token_stored
                    } else {
                        R.string.remote_provider_token_not_stored
                    },
                ),
            )
        } else {
            getString(R.string.remote_provider_disabled_status)
        }
    }

    private fun recipientProfileLabel(profile: RecipientProfile): String = when (profile) {
        RecipientProfile.NONE -> getString(R.string.recipient_profile_none)
        RecipientProfile.FRIEND -> getString(R.string.recipient_profile_friend)
        RecipientProfile.WORK -> getString(R.string.recipient_profile_work)
        RecipientProfile.CLIENT -> getString(R.string.recipient_profile_client)
        RecipientProfile.FORMAL_OFFICE -> getString(R.string.recipient_profile_formal_office)
    }

    private fun languageLabel(language: String?, emptyLabel: Int): String = when (language) {
        null -> getString(emptyLabel)
        LANGUAGE_POLISH -> getString(R.string.language_polish)
        LANGUAGE_ENGLISH -> getString(R.string.language_english)
        else -> language
    }

    private fun isRecommendedModelInstalled(): Boolean =
        managedInstallCoordinator.currentManagedSelection() != null

    private fun matchWidth() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    )

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private companion object {
        const val REQUEST_LOCAL_MODEL = 1001
        const val TAG = "IntentKeyboardSetup"
        const val LANGUAGE_POLISH = "Polish"
        const val LANGUAGE_ENGLISH = "English"
    }
}
