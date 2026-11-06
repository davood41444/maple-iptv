package com.mapleonlinesolutions.iptv

import android.net.Uri
import android.webkit.WebResourceResponse
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

/**
 * Serves `/proxy?url=...` for the page so it can download playlists from any
 * IPTV server: those rarely send CORS headers and are usually plain http,
 * which the https asset origin could not fetch directly.
 */
class HttpProxy(private val http: OkHttpClient) {
    fun fetch(uri: Uri): WebResourceResponse {
        val target = uri.getQueryParameter("url")
        if (target == null || !(target.startsWith("http://") || target.startsWith("https://"))) {
            return failure(400, "Bad Request", "Missing or invalid url")
        }
        val request = Request.Builder().url(target)
            .apply { uri.getQueryParameter("ua")?.let { header("User-Agent", it) } }
            .build()
        return try {
            val response = http.newCall(request).execute()
            val type = response.body.contentType()
            // WebResourceResponse rejects 3xx codes; OkHttp has already followed redirects.
            val status = if (response.code in 300..399) 502 else response.code
            WebResourceResponse(
                type?.let { "${it.type}/${it.subtype}" } ?: "text/plain",
                type?.charset()?.name() ?: "utf-8",
                status,
                response.message.ifBlank { "OK" },
                mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "no-store"),
                response.body.byteStream(),
            )
        } catch (e: IOException) {
            failure(502, "Bad Gateway", e.message ?: "Network error")
        } catch (e: IllegalArgumentException) {
            failure(400, "Bad Request", e.message ?: "Invalid url")
        }
    }

    private fun failure(code: Int, reason: String, body: String) = WebResourceResponse(
        "text/plain", "utf-8", code, reason,
        mapOf("Access-Control-Allow-Origin" to "*"),
        body.byteInputStream(),
    )
}
