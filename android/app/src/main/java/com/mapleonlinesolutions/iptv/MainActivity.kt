package com.mapleonlinesolutions.iptv

import android.annotation.SuppressLint
import android.app.UiModeManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.inputmethod.InputMethodManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.webkit.WebViewAssetLoader
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Hosts the shared TV interface (the top-level web/ folder) in a transparent
 * WebView, with ExoPlayer drawing the video in a PlayerView underneath it.
 */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var player: NativePlayer
    private lateinit var proxy: HttpProxy
    private lateinit var phoneServer: PhoneServer
    private lateinit var billing: Billing
    private lateinit var updater: Updater

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val http = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()

        val playerView = PlayerView(this).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
            isFocusable = false
        }
        webView = WebView(this).apply { setBackgroundColor(Color.TRANSPARENT) }
        setContentView(FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(playerView, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            addView(webView, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        })

        // Many IPTV accounts allow a single connection: don't keep idle video
        // connections open (the server counts them), and give up on a stalled
        // connection quickly so playback can reconnect.
        val mediaHttp = http.newBuilder()
            .readTimeout(15, TimeUnit.SECONDS)
            .connectionPool(ConnectionPool(0, 1, TimeUnit.SECONDS))
            .build()
        player = NativePlayer(this, playerView, mediaHttp, ::sendToPage)
        proxy = HttpProxy(http)
        phoneServer = PhoneServer { fields -> sendToPage(JSONObject().put("type", "phone").put("data", fields)) }
        billing = Billing(this, ::sendToPage)
        updater = Updater(this, http, ::sendToPage)
        setUpWebView()
        webView.requestFocus()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setUpWebView() {
        WebView.setWebContentsDebuggingEnabled(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            // Channel logos are usually served over plain http.
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        webView.addJavascriptInterface(PageBridge(), "AndroidHost")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url
                if (url.host == WebViewAssetLoader.DEFAULT_DOMAIN && url.path == "/proxy") return proxy.fetch(url)
                return assetLoader.shouldInterceptRequest(url)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != WebViewAssetLoader.DEFAULT_DOMAIN
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d(TAG, "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }
        webView.loadUrl("https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/index.html")
    }

    /** Delivers an event to the page; see App.native in web/js/player.js. */
    private fun sendToPage(event: JSONObject) {
        webView.post { webView.evaluateJavascript("window.__nativeEvent && window.__nativeEvent($event)", null) }
    }

    // D-pad, OK and number keys reach the page as normal key events. Remote
    // keys the WebView doesn't understand (Back, channel and media keys) are
    // forwarded by name instead.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val name = FORWARDED_KEYS[event.keyCode] ?: return super.dispatchKeyEvent(event)
        if (event.action == KeyEvent.ACTION_DOWN) {
            sendToPage(JSONObject().put("type", "key").put("key", name).put("repeat", event.repeatCount > 0))
        }
        return true
    }

    // Phones: hide the status and navigation bars (a swipe from the edge shows them briefly).
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
    }

    override fun onStart() {
        super.onStart()
        player.onForeground()
    }

    override fun onResume() {
        super.onResume()
        billing.refresh()
    }

    override fun onStop() {
        player.onBackground()
        super.onStop()
    }

    override fun onDestroy() {
        phoneServer.stop()
        player.release()
        webView.destroy()
        super.onDestroy()
    }

    /** Called from JavaScript on the WebView's bridge thread. */
    private inner class PageBridge {
        @JavascriptInterface
        fun play(url: String, headersJson: String?, startMs: Double) {
            val headers = mutableMapOf<String, String>()
            if (!headersJson.isNullOrBlank()) {
                val json = JSONObject(headersJson)
                json.keys().forEach { headers[it] = json.getString(it) }
            }
            runOnUiThread { player.play(url, headers, startMs.toLong()) }
        }

        @JavascriptInterface
        fun stop() = runOnUiThread { player.stop() }

        @JavascriptInterface
        fun pause() = runOnUiThread { player.pause() }

        @JavascriptInterface
        fun resume() = runOnUiThread { player.resume() }

        @JavascriptInterface
        fun seekTo(positionMs: Double) = runOnUiThread { player.seekTo(positionMs.toLong()) }

        @JavascriptInterface
        fun selectTrack(type: String, id: String) = runOnUiThread { player.selectTrack(type, id) }

        @JavascriptInterface
        fun setSubtitleLanguage(language: String) = runOnUiThread { player.setSubtitleLanguage(language) }

        @JavascriptInterface
        fun setSubtitleStyle(styleJson: String) {
            val style = JSONObject(styleJson)
            runOnUiThread {
                player.setSubtitleStyle(
                    style.optDouble("size", 1.0),
                    style.optString("color", "#ffffff"),
                    style.optString("background", "shadow"),
                    style.optString("font", "default"),
                )
            }
        }

        @JavascriptInterface
        fun setResizeMode(mode: String) = runOnUiThread { player.setResizeMode(mode) }

        @JavascriptInterface
        fun setVideoRect(x: Double, y: Double, width: Double, height: Double) = runOnUiThread {
            player.setVideoRect(x.toInt(), y.toInt(), width.toInt(), height.toInt())
        }

        @JavascriptInterface
        fun billingStart() = runOnUiThread { billing.start() }

        @JavascriptInterface
        fun billingBuy(planId: String) = runOnUiThread { billing.buy(planId) }

        /**
         * When the free trial started (ms). Based on the install time, which clearing
         * the app's data doesn't change; kept in preferences that Android backs up,
         * so it can also survive a reinstall.
         */
        @JavascriptInterface
        fun trialStart(): Double {
            val installed = packageManager.getPackageInfo(packageName, 0).firstInstallTime
            val prefs = getSharedPreferences("premium", MODE_PRIVATE)
            val saved = prefs.getLong("trialStart", 0)
            val start = if (saved > 0) minOf(saved, installed) else installed
            if (start != saved) prefs.edit().putLong("trialStart", start).apply()
            return start.toDouble()
        }

        /** Serves formHtml to phones on the network; returns the address to show, or "". */
        @JavascriptInterface
        fun startPhoneServer(formHtml: String, doneHtml: String): String = phoneServer.start(formHtml, doneHtml)

        @JavascriptInterface
        fun stopPhoneServer() = phoneServer.stop()

        /** Opens a link in another app, e.g. a trailer in YouTube. */
        @JavascriptInterface
        fun openUrl(url: String) = runOnUiThread {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e: ActivityNotFoundException) {
                Log.w(TAG, "No app can open $url")
            }
        }

        @JavascriptInterface
        fun showKeyboard() = runOnUiThread {
            getSystemService(InputMethodManager::class.java).showSoftInput(webView, 0)
        }

        @JavascriptInterface
        fun hideKeyboard() = runOnUiThread {
            getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(webView.windowToken, 0)
        }

        @JavascriptInterface
        fun exitApp() = runOnUiThread { finish() }

        /** In-app update (web/js/update.js): download, check and open Android's installer. */
        @JavascriptInterface
        fun installUpdate(url: String, sha256: String) = updater.install(url, sha256)

        @JavascriptInterface
        fun installedFromStore(): Boolean = updater.installedFromStore()

        @JavascriptInterface
        fun appVersion(): String = packageManager.getPackageInfo(packageName, 0).versionName ?: ""

        /** The device, for the install report (web/js/report.js) when the user allowed it. */
        @JavascriptInterface
        fun deviceInfo(): String = JSONObject()
            .put("maker", Build.MANUFACTURER)
            .put("model", Build.MODEL)
            .put("os", "Android " + Build.VERSION.RELEASE)
            .put("tv", (getSystemService(UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION)
            .toString()

        // Phones and tablets get touch controls; TVs keep the remote layout.
        @JavascriptInterface
        fun hasTouchscreen(): Boolean =
            packageManager.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN) &&
                (getSystemService(UI_MODE_SERVICE) as UiModeManager).currentModeType != Configuration.UI_MODE_TYPE_TELEVISION
    }

    companion object {
        private const val TAG = "HomeIPTV"

        private val FORWARDED_KEYS = mapOf(
            KeyEvent.KEYCODE_BACK to "Back",
            KeyEvent.KEYCODE_CHANNEL_UP to "ChannelUp",
            KeyEvent.KEYCODE_CHANNEL_DOWN to "ChannelDown",
            KeyEvent.KEYCODE_MEDIA_NEXT to "ChannelUp",
            KeyEvent.KEYCODE_MEDIA_PREVIOUS to "ChannelDown",
            KeyEvent.KEYCODE_LAST_CHANNEL to "LastChannel",
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to "PlayPause",
            KeyEvent.KEYCODE_MEDIA_PLAY to "Play",
            KeyEvent.KEYCODE_MEDIA_PAUSE to "Pause",
            KeyEvent.KEYCODE_MEDIA_STOP to "Stop",
            KeyEvent.KEYCODE_INFO to "Info",
            KeyEvent.KEYCODE_GUIDE to "Guide",
            KeyEvent.KEYCODE_MENU to "Menu",
            KeyEvent.KEYCODE_PROG_RED to "Red",
            KeyEvent.KEYCODE_PROG_GREEN to "Green",
            KeyEvent.KEYCODE_PROG_YELLOW to "Yellow",
            KeyEvent.KEYCODE_PROG_BLUE to "Blue",
        )
    }
}
