package com.celemod.runtime

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Saved passwords/tokens never enter the WebView, public storage, logs, or Android backups. */
internal object SteamVault {
    private const val ALIAS = "celemod.steam.refresh.v1"
    private fun file(context: Context) = File(context.filesDir, "steam-account.enc.json")
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun read(context: Context): JSONObject? {
        if (!file(context).isFile) return null
        val data = JSONObject(AtomicFile(file(context)).openRead().use { it.readBytes().toString(Charsets.UTF_8) })
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(data.getString("iv"), Base64.NO_WRAP)))
        return JSONObject(cipher.doFinal(Base64.decode(data.getString("data"), Base64.NO_WRAP)).toString(Charsets.UTF_8))
    }
    @Synchronized fun write(context: Context, account: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val bytes = cipher.doFinal(account.toString().toByteArray())
        SteamBridge.atomic(file(context), JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)))
    }
    @Synchronized fun passwordFor(context: Context, accountName: String): String {
        val account = read(context) ?: error("请重新输入密码")
        require(account.optString("account").equals(accountName.trim(), ignoreCase = true)) { "请为此账号输入密码" }
        return account.optString("password").takeIf { it.isNotEmpty() } ?: error("请重新输入密码")
    }
    @Synchronized fun clear(context: Context) {
        AtomicFile(file(context)).delete()
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(ALIAS) }
    }
}
