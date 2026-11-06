package com.mapleonlinesolutions.iptv

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * In-app updates (web/js/update.js): downloads the new MapleIPTV.apk from the GitHub
 * release, checks its SHA-256, and opens Android's installer. Android then asks the user
 * to tap Install (and, the first time, to allow installing apps from Maple IPTV).
 * The new APK must be signed with the same key (android/signing), or Android refuses it.
 */
class Updater(
    private val activity: Activity,
    private val http: OkHttpClient,
    private val send: (JSONObject) -> Unit,
) {
    @Volatile private var running = false

    /** Installed by Google Play: Google Play updates the app, so the app doesn't. */
    fun installedFromStore(): Boolean = try {
        val installer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activity.packageManager.getInstallSourceInfo(activity.packageName).installingPackageName
        } else {
            @Suppress("DEPRECATION")
            activity.packageManager.getInstallerPackageName(activity.packageName)
        }
        installer == "com.android.vending"
    } catch (e: Exception) {
        false
    }

    fun install(url: String, sha256: String) {
        if (running) return
        running = true
        Thread {
            try {
                val file = download(url, sha256)
                activity.runOnUiThread { openInstaller(file) }
                event("installer")
            } catch (e: Exception) {
                Log.w(TAG, "Update failed", e)
                event("error", e.message)
            } finally {
                running = false
            }
        }.start()
    }

    private fun download(url: String, sha256: String): File {
        val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, "MapleIPTV.apk")
        val digest = MessageDigest.getInstance("SHA-256")
        http.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("HTTP ${response.code}")
            val body = response.body
            val total = body.contentLength()
            var received = 0L
            var lastPercent = -1
            body.byteStream().use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        digest.update(buffer, 0, n)
                        received += n
                        val percent = if (total > 0) (received * 100 / total).toInt() else 0
                        if (percent != lastPercent) {
                            lastPercent = percent
                            send(JSONObject().put("type", "update").put("state", "progress").put("percent", percent))
                        }
                    }
                }
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (sha256.isNotEmpty() && !actual.equals(sha256, ignoreCase = true)) {
            file.delete()
            throw IllegalStateException("The download is damaged (SHA-256 mismatch)")
        }
        return file
    }

    private fun openInstaller(file: File) {
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".updates", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
    }

    private fun event(state: String, message: String? = null) {
        val event = JSONObject().put("type", "update").put("state", state)
        if (message != null) event.put("message", message)
        send(event)
    }

    companion object {
        private const val TAG = "HomeIPTV"
    }
}
