package io.github.twojstar.intentkeyboard.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.format.Formatter
import android.view.Gravity
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
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

    private var modelOperationInProgress = false
    private var modelStatusView: TextView? = null
    private var importModelButton: Button? = null
    private var clearModelButton: Button? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
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

        setContentView(
            root,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )

        refreshModelStatus()
    }

    override fun onResume() {
        super.onResume()
        if (!modelOperationInProgress) refreshModelStatus()
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
        modelOperationInProgress = true
        setModelControlsEnabled(false)
        modelStatusView?.text = getString(R.string.importing_local_model)

        scope.launch {
            try {
                modelStore.importModel(uri)
                refreshModelStatus()
            } catch (error: CancellationException) {
                throw error
            } catch (error: LocalModelStoreException) {
                modelStatusView?.text = error.message ?: getString(R.string.local_model_import_failed)
            } finally {
                modelOperationInProgress = false
                setModelControlsEnabled(true)
            }
        }
    }

    private fun clearLocalModel() {
        modelOperationInProgress = true
        setModelControlsEnabled(false)

        scope.launch {
            try {
                modelStore.clearModel()
                refreshModelStatus()
            } catch (error: CancellationException) {
                throw error
            } catch (error: LocalModelStoreException) {
                modelStatusView?.text = error.message ?: getString(R.string.local_model_clear_failed)
            } finally {
                modelOperationInProgress = false
                setModelControlsEnabled(true)
            }
        }
    }

    private fun refreshModelStatus() {
        val selection = modelStore.current()
        clearModelButton?.isEnabled = selection != null

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

    private fun setModelControlsEnabled(enabled: Boolean) {
        importModelButton?.isEnabled = enabled
        clearModelButton?.isEnabled = enabled && modelStore.current() != null
    }

    private fun matchWidth() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
    )

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private companion object {
        const val REQUEST_LOCAL_MODEL = 1001
    }
}
