package com.mapleonlinesolutions.iptv

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import androidx.media3.ui.SubtitleView
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject

/** ExoPlayer wrapper driven by the page. All methods run on the main thread. */
@OptIn(UnstableApi::class)
class NativePlayer(
    private val context: Context,
    private val view: PlayerView,
    private val http: OkHttpClient,
    private val emit: (JSONObject) -> Unit,
) {
    private data class Stream(val url: String, val headers: Map<String, String>, val asHls: Boolean)

    private var exo: ExoPlayer? = null
    private var current: Stream? = null
    private var resumeInForeground = false
    private var resumePositionMs = 0L
    private var subtitleLanguage = "fa"

    private val handler = Handler(Looper.getMainLooper())

    // Reports the playback position once a second, for movie and episode progress bars.
    private val ticker = object : Runnable {
        override fun run() {
            exo?.let { if (it.isPlaying) emitTime(it) }
            handler.postDelayed(this, 1000)
        }
    }

    fun play(url: String, headers: Map<String, String>, startMs: Long) =
        start(Stream(url, headers, looksLikeHls(url)), startMs)

    fun stop() {
        current = null
        exo?.stop()
        exo?.clearMediaItems()
        view.keepScreenOn = false
    }

    fun pause() {
        exo?.pause()
    }

    fun resume() {
        exo?.play()
    }

    fun seekTo(positionMs: Long) {
        val player = exo ?: return
        player.seekTo(positionMs.coerceAtLeast(0))
        emitTime(player)
    }

    /** Shows the video in a box (screen pixels), e.g. the preview on the channel list; zero size = full screen. */
    fun setVideoRect(x: Int, y: Int, width: Int, height: Int) {
        view.layoutParams = if (width <= 0 || height <= 0) {
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        } else {
            FrameLayout.LayoutParams(width, height, Gravity.TOP or Gravity.LEFT).apply {
                leftMargin = x
                topMargin = y
            }
        }
    }

    fun setResizeMode(mode: String) {
        view.resizeMode = when (mode) {
            "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
            "zoom" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
    }

    /** "fa", "en", … picks subtitles in that language automatically; "off" turns them off. */
    fun setSubtitleLanguage(language: String) {
        subtitleLanguage = language
        exo?.let { applySubtitleLanguage(it) }
    }

    /**
     * Subtitle look, from the settings page: size (1.0 = normal), text colour (#rrggbb),
     * background ("shadow" outline, "box" translucent, "black") and font ("default", "bold", "vazirmatn").
     */
    fun setSubtitleStyle(size: Double, color: String, background: String, font: String) {
        val subtitles = view.subtitleView ?: return
        val typeface = when (font) {
            "vazirmatn" -> Typeface.createFromAsset(context.assets, "subtitle-fonts/Vazirmatn-Medium.ttf")
            "bold" -> Typeface.DEFAULT_BOLD
            else -> null
        }
        val backgroundColor = when (background) {
            "black" -> Color.BLACK
            "box" -> 0x99000000.toInt()
            else -> Color.TRANSPARENT
        }
        val edge = if (background == "shadow") CaptionStyleCompat.EDGE_TYPE_OUTLINE else CaptionStyleCompat.EDGE_TYPE_NONE
        subtitles.setApplyEmbeddedStyles(false)
        subtitles.setApplyEmbeddedFontSizes(false)
        subtitles.setStyle(CaptionStyleCompat(Color.parseColor(color), backgroundColor, Color.TRANSPARENT, edge, Color.BLACK, typeface))
        subtitles.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * size.toFloat())
    }

    /** type is "audio" or "text"; id comes from the tracks event ("group:track"), or "off" for text. */
    fun selectTrack(type: String, id: String) {
        val player = exo ?: return
        val trackType = if (type == "audio") C.TRACK_TYPE_AUDIO else C.TRACK_TYPE_TEXT
        val params = player.trackSelectionParameters.buildUpon()
        if (id == "off") {
            params.setTrackTypeDisabled(trackType, true)
        } else {
            val parts = id.split(":")
            val group = player.currentTracks.groups.getOrNull(parts[0].toInt()) ?: return
            params.setTrackTypeDisabled(trackType, false)
                .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, parts[1].toInt()))
        }
        player.trackSelectionParameters = params.build()
    }

    /** Live streams reconnect when the app returns; movies continue where they were. */
    fun onBackground() {
        val player = exo ?: return
        if (current != null) {
            resumeInForeground = true
            resumePositionMs = if (player.isCurrentMediaItemLive) 0 else player.currentPosition
            player.stop()
        }
    }

    fun onForeground() {
        if (resumeInForeground) {
            resumeInForeground = false
            current?.let { start(it, resumePositionMs) }
        }
    }

    fun release() {
        handler.removeCallbacks(ticker)
        exo?.release()
        exo = null
    }

    private fun start(stream: Stream, startMs: Long) {
        current = stream
        val dataSource = OkHttpDataSource.Factory(http).setDefaultRequestProperties(stream.headers)
        stream.headers["User-Agent"]?.let(dataSource::setUserAgent)

        val item = MediaItem.Builder()
            .setUri(stream.url)
            .apply { if (stream.asHls) setMimeType(MimeTypes.APPLICATION_M3U8) }
            .build()

        val player = exo ?: ExoPlayer.Builder(context)
            .setAudioAttributes(AudioAttributes.DEFAULT, true)
            .build()
            .also {
                it.addListener(listener)
                applySubtitleLanguage(it)
                view.player = it
                exo = it
                handler.post(ticker)
            }
        val source = DefaultMediaSourceFactory(dataSource).createMediaSource(item)
        if (startMs > 0) player.setMediaSource(source, startMs) else player.setMediaSource(source)
        player.prepare()
        player.playWhenReady = true
        view.keepScreenOn = true
    }

    private fun applySubtitleLanguage(player: ExoPlayer) {
        val params = player.trackSelectionParameters.buildUpon()
        if (subtitleLanguage == "off") {
            params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).setPreferredTextLanguage(subtitleLanguage)
        }
        player.trackSelectionParameters = params.build()
    }

    private fun emitTime(player: ExoPlayer) {
        val duration = if (player.duration == C.TIME_UNSET) -1 else player.duration
        emit(event("time").put("position", player.currentPosition).put("duration", duration))
    }

    private val listener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            val value = when (playbackState) {
                Player.STATE_BUFFERING -> "buffering"
                Player.STATE_READY -> "ready"
                Player.STATE_ENDED -> "ended"
                else -> "idle"
            }
            emit(event("state").put("value", value))
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            emit(event("playing").put("value", isPlaying))
        }

        override fun onVideoSizeChanged(videoSize: VideoSize) {
            if (videoSize.width > 0) {
                emit(event("video").put("width", videoSize.width).put("height", videoSize.height))
            }
        }

        override fun onTracksChanged(tracks: Tracks) {
            val audio = JSONArray()
            val text = JSONArray()
            tracks.groups.forEachIndexed { g, group ->
                val list = when (group.type) {
                    C.TRACK_TYPE_AUDIO -> audio
                    C.TRACK_TYPE_TEXT -> text
                    else -> return@forEachIndexed
                }
                for (t in 0 until group.length) {
                    if (!group.isTrackSupported(t)) continue
                    val format = group.getTrackFormat(t)
                    list.put(
                        JSONObject()
                            .put("id", "$g:$t")
                            .put("language", format.language ?: "")
                            .put("label", format.label ?: "")
                            .put("channels", format.channelCount)
                            .put("selected", group.isTrackSelected(t)),
                    )
                }
            }
            emit(event("tracks").put("audio", audio).put("text", text))
        }

        override fun onPlayerError(error: PlaybackException) {
            val stream = current ?: return
            when {
                error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW -> {
                    exo?.seekToDefaultPosition()
                    exo?.prepare()
                    return
                }
                // Some playlists hide HLS behind URLs without an .m3u8 extension.
                error.errorCode == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED && !stream.asHls -> {
                    start(stream.copy(asHls = true), 0)
                    return
                }
            }
            val cause = error.cause
            val message = if (cause is HttpDataSource.InvalidResponseCodeException) "HTTP ${cause.responseCode}" else error.errorCodeName
            emit(event("error").put("code", error.errorCodeName).put("message", message))
        }
    }

    private fun event(type: String) = JSONObject().put("type", "player").put("event", type)

    private fun looksLikeHls(url: String) = url.contains("m3u8", ignoreCase = true)
}
