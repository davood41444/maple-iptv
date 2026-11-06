package com.mapleonlinesolutions.iptv

import android.util.Log
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.SecureRandom
import kotlin.concurrent.thread

/**
 * A tiny web server, running only while the "add from phone" screen is open,
 * so a phone on the same network can type the playlist details. The page and
 * its texts come from the TV interface; a random code in the address keeps
 * other devices out. Submitted fields are passed to onSubmit as JSON.
 */
class PhoneServer(private val onSubmit: (JSONObject) -> Unit) {
    private var socket: ServerSocket? = null
    private var formHtml = ""
    private var doneHtml = ""
    private var token = ""

    /** Starts serving and returns the address to show (http://ip:port/token), or "" if it couldn't. */
    @Synchronized
    fun start(formHtml: String, doneHtml: String): String {
        stop()
        val ip = localAddress() ?: return ""
        this.formHtml = formHtml
        this.doneHtml = doneHtml
        token = (1..6).map { ALPHABET[random.nextInt(ALPHABET.length)] }.joinToString("")
        val server = (PORT until PORT + 10).firstNotNullOfOrNull { port ->
            try { ServerSocket(port) } catch (e: Exception) { null }
        } ?: return ""
        socket = server
        thread(name = "PhoneServer", isDaemon = true) {
            while (!server.isClosed) {
                try {
                    val client = server.accept()
                    thread(isDaemon = true) { client.use { handle(it) } }
                } catch (e: Exception) {
                    break
                }
            }
        }
        return "http://$ip:${server.localPort}/$token"
    }

    @Synchronized
    fun stop() {
        socket?.close()
        socket = null
    }

    private fun handle(client: Socket) {
        try {
            client.soTimeout = 10000
            val input = BufferedInputStream(client.getInputStream())
            val requestLine = readLine(input) ?: return
            var contentLength = 0
            while (true) {
                val header = readLine(input) ?: break
                if (header.isEmpty()) break
                if (header.startsWith("Content-Length:", ignoreCase = true)) {
                    contentLength = header.substringAfter(':').trim().toIntOrNull() ?: 0
                }
            }
            val parts = requestLine.split(" ")
            val method = parts.getOrElse(0) { "" }
            val path = parts.getOrElse(1) { "" }.substringBefore('?').trim('/')
            when {
                path != token -> respond(client, 404, "Not found")
                method == "GET" -> respond(client, 200, formHtml)
                method == "POST" && contentLength in 1..MAX_BODY -> {
                    val body = ByteArray(contentLength)
                    var read = 0
                    while (read < contentLength) {
                        val n = input.read(body, read, contentLength - read)
                        if (n < 0) break
                        read += n
                    }
                    onSubmit(parseForm(String(body, 0, read, Charsets.UTF_8)))
                    respond(client, 200, doneHtml)
                }
                else -> respond(client, 400, "Bad request")
            }
        } catch (e: Exception) {
            Log.w("PhoneServer", "Request failed", e)
        }
    }

    private fun readLine(input: BufferedInputStream): String? {
        val bytes = ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b < 0) return if (bytes.size() == 0) null else bytes.toString("UTF-8")
            if (b == '\n'.code) return bytes.toString("UTF-8").trimEnd('\r')
            bytes.write(b)
            if (bytes.size() > 8192) return null
        }
    }

    private fun respond(client: Socket, status: Int, html: String) {
        val body = html.toByteArray(Charsets.UTF_8)
        val head = "HTTP/1.1 $status ${if (status == 200) "OK" else "Error"}\r\n" +
            "Content-Type: text/html; charset=utf-8\r\nContent-Length: ${body.size}\r\n" +
            "Cache-Control: no-store\r\nConnection: close\r\n\r\n"
        val out = client.getOutputStream()
        out.write(head.toByteArray(Charsets.US_ASCII))
        out.write(body)
        out.flush()
    }

    private fun parseForm(body: String) = JSONObject().apply {
        body.split('&').filter { it.contains('=') }.forEach {
            put(URLDecoder.decode(it.substringBefore('='), "UTF-8"), URLDecoder.decode(it.substringAfter('='), "UTF-8"))
        }
    }

    // The TV's address on the home network (Wi-Fi or Ethernet).
    private fun localAddress(): String? = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { it.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .firstOrNull { it.isSiteLocalAddress }
        ?.hostAddress

    companion object {
        private const val PORT = 8899
        private const val MAX_BODY = 16384
        private const val ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"
        private val random = SecureRandom()
    }
}
