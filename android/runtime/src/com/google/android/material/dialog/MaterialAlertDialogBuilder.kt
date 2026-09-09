package com.google.android.material.dialog

import android.content.Context
import androidx.appcompat.app.AlertDialog

/**
 * ABI-compatible subset used by Tauri's Android dialog plugin.
 *
 * The upstream plugin only constructs this class with a Context and calls
 * AlertDialog.Builder methods, so shipping all of Material Components is
 * unnecessary for CeleMod's WebView-based Android UI.
 */
class MaterialAlertDialogBuilder(context: Context) : AlertDialog.Builder(context)
