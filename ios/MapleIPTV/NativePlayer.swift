import MobileVLCKit
import UIKit

/// Plays streams with VLC (MobileVLCKit) in a view underneath the page: live TS and HLS,
/// MKV/MP4 movies with their audio and subtitle tracks, and AC-3/DTS sound, which iOS's
/// own player can't handle. Reports to the page as "player" events in the same shape as
/// the Android app's ExoPlayer (web/js/player.js, adapters.android).
final class NativePlayer: NSObject, VLCMediaPlayerDelegate {
    private let view: UIView
    private let emit: ([String: Any]) -> Void
    private var player: VLCMediaPlayer
    private var playerOptions: [String] = []
    private var current: (url: String, headers: [String: String])?
    private var subtitleLanguage = "fa"
    private var styleOptions: [String] = []
    private var resizeMode = "fit"
    private var stopping = false
    private var subtitleChecked = false
    private var lastTime = Date.distantPast
    private var lastTracks = ""
    private var lastVideoSize = CGSize.zero
    private var resumeInForeground = false
    private var resumePositionMs: Double = 0

    // ISO 639 codes VLC compares with the tracks' languages, for the subtitles setting.
    private static let subtitleLanguages = ["fa": "fa,fas,per", "en": "en,eng"]

    init(view: UIView, emit: @escaping ([String: Any]) -> Void) {
        self.view = view
        self.emit = emit
        player = VLCMediaPlayer()
        super.init()
        attach(player)
    }

    private func attach(_ p: VLCMediaPlayer) {
        p.drawable = view
        p.delegate = self
    }

    // MARK: - Commands from the page

    func play(url: String, headers: [String: String], startMs: Double) {
        current = (url, headers)
        start(startMs: startMs)
    }

    func stop() {
        current = nil
        resumeInForeground = false
        stopping = true
        player.stop()
        UIApplication.shared.isIdleTimerDisabled = false
    }

    func pause() {
        player.pause()
    }

    func resume() {
        if player.media != nil { player.play() }
    }

    func seekTo(_ ms: Double) {
        player.time = VLCTime(int: Int32(clamping: Int(max(0, ms))))
        emitTime(force: true)
    }

    /// type is "audio" or "text"; id comes from the tracks event (VLC's track id), or "off" for text.
    func selectTrack(type: String, id: String) {
        if type == "audio", let index = Int32(id) {
            player.currentAudioTrackIndex = index
        } else if type == "text" {
            player.currentVideoSubTitleIndex = id == "off" ? -1 : (Int32(id) ?? -1)
        }
        reportTracks(force: true)
    }

    /// "fa", "en", … picks subtitles in that language when a stream starts; "off" turns them off.
    func setSubtitleLanguage(_ language: String) {
        subtitleLanguage = language
        if language == "off" { player.currentVideoSubTitleIndex = -1 }
    }

    /// Subtitle look from the settings page. VLC takes it as player options, so it applies
    /// from the next stream started (settings aren't changed during playback).
    func setSubtitleStyle(size: Double, color: String, background: String, font: String) {
        // VLC's relative font size: smaller numbers are bigger text (16 = normal).
        let relative = size >= 1.6 ? 9 : size >= 1.25 ? 12 : size <= 0.85 ? 18 : 16
        var options = ["--freetype-rel-fontsize=\(relative)", "--freetype-color=\(rgb(color))"]
        switch background {
        case "black": options += ["--freetype-background-opacity=255", "--freetype-background-color=0", "--freetype-outline-thickness=0"]
        case "box": options += ["--freetype-background-opacity=150", "--freetype-background-color=0", "--freetype-outline-thickness=0"]
        default: options += ["--freetype-background-opacity=0", "--freetype-outline-thickness=4"]
        }
        if font == "bold" || font == "vazirmatn" { options.append("--freetype-bold") }
        styleOptions = options
    }

    func setResizeMode(_ mode: String) {
        resizeMode = mode
        applyResizeMode()
    }

    func viewResized() {
        applyResizeMode()
    }

    /// Live streams reconnect when the app comes back; movies continue where they were.
    func onBackground() {
        guard current != nil else { return }
        resumeInForeground = true
        let length = player.media?.length.intValue ?? 0
        resumePositionMs = length > 0 ? Double(player.time.intValue) : 0
        stopping = true
        player.stop()
    }

    func onForeground() {
        guard resumeInForeground, current != nil else { return }
        resumeInForeground = false
        start(startMs: resumePositionMs)
    }

    // MARK: - Playback

    private func start(startMs: Double) {
        guard let stream = current, let url = URL(string: stream.url) else {
            emitEvent("error", ["message": "Invalid stream address"])
            return
        }
        // A new subtitle look needs a new VLC instance.
        if styleOptions != playerOptions {
            player.delegate = nil
            player.stop()
            player = VLCMediaPlayer(options: styleOptions)
            attach(player)
            playerOptions = styleOptions
        }
        let media = VLCMedia(url: url)
        if let ua = stream.headers["User-Agent"], !ua.isEmpty { media.addOption(":http-user-agent=\(ua)") }
        if let referrer = stream.headers["Referer"], !referrer.isEmpty { media.addOption(":http-referrer=\(referrer)") }
        // A little more buffer than VLC's default: IPTV servers are often far away.
        media.addOption(":network-caching=2000")
        if startMs > 0 { media.addOption(":start-time=\(startMs / 1000)") }
        if let languages = Self.subtitleLanguages[subtitleLanguage] { media.addOption(":sub-language=\(languages)") }

        stopping = false
        subtitleChecked = false
        lastTracks = ""
        lastVideoSize = .zero
        player.media = media
        player.play()
        applyResizeMode()
        UIApplication.shared.isIdleTimerDisabled = true
        emitEvent("state", ["value": "buffering"])
    }

    // VLC takes "fill" as a forced aspect ratio and "zoom" as a crop, both the view's shape;
    // an empty value puts the video's own shape back.
    private func applyResizeMode() {
        let size = view.bounds.size
        guard size.width > 0, size.height > 0 else { return }
        let shape = "\(Int(size.width.rounded())):\(Int(size.height.rounded()))"
        setString(resizeMode == "fill" ? shape : "") { self.player.videoAspectRatio = $0 }
        setString(resizeMode == "zoom" ? shape : "") { self.player.videoCropGeometry = $0 }
    }

    // libvlc copies the string, so the C copy only has to live during the call.
    private func setString(_ value: String, _ apply: (UnsafeMutablePointer<CChar>) -> Void) {
        guard let copy = strdup(value) else { return }
        apply(copy)
        free(copy)
    }

    // MARK: - Events to the page

    func mediaPlayerStateChanged(_ aNotification: Notification) {
        switch player.state {
        case .opening, .buffering:
            // VLC also reports buffering now and then while it plays smoothly.
            if !player.isPlaying { emitEvent("state", ["value": "buffering"]) }
        case .playing:
            emitEvent("state", ["value": "ready"])
            emitEvent("playing", ["value": true])
            reportVideoSize()
            reportTracks(force: false)
        case .paused:
            emitEvent("playing", ["value": false])
        case .ended:
            emitEvent("state", ["value": "ended"])
        case .error:
            emitEvent("error", ["message": "This stream could not be played"])
        case .stopped:
            // Stopped by us: nothing to report. By itself (a live stream that dropped): ended, so the page reconnects.
            if !stopping && current != nil { emitEvent("state", ["value": "ended"]) }
        case .esAdded:
            reportVideoSize()
            reportTracks(force: false)
        @unknown default:
            break
        }
    }

    func mediaPlayerTimeChanged(_ aNotification: Notification) {
        emitTime(force: false)
    }

    // The position once a second, for the progress bar of movies and episodes.
    private func emitTime(force: Bool) {
        guard force || Date().timeIntervalSince(lastTime) >= 1 else { return }
        lastTime = Date()
        let length = Double(player.media?.length.intValue ?? 0)
        emitEvent("time", ["position": Double(player.time.intValue), "duration": length > 0 ? length : -1])
    }

    private func reportVideoSize() {
        let size = player.videoSize
        guard size.width > 0, size.height > 0, size != lastVideoSize else { return }
        lastVideoSize = size
        emitEvent("video", ["width": Int(size.width), "height": Int(size.height)])
    }

    private func reportTracks(force: Bool) {
        let info = (player.media?.tracksInformation as? [[String: Any]]) ?? []
        func details(_ id: Int32) -> [String: Any]? {
            info.first { ($0[VLCMediaTracksInformationId] as? NSNumber)?.int32Value == id }
        }
        func tracks(names: [Any]?, ids: [Any]?, current: Int32) -> [[String: Any]] {
            let names = names ?? []
            var out: [[String: Any]] = []
            for (i, raw) in (ids ?? []).enumerated() {
                guard let id = (raw as? NSNumber)?.int32Value, id >= 0 else { continue } // -1 is VLC's "Disable"
                let d = details(id)
                out.append([
                    "id": String(id),
                    "language": d?[VLCMediaTracksInformationLanguage] as? String ?? "",
                    "label": label(i < names.count ? "\(names[i])" : ""),
                    "channels": (d?[VLCMediaTracksInformationAudioChannelsNumber] as? NSNumber)?.intValue ?? 0,
                    "selected": id == current,
                ])
            }
            return out
        }
        let audio = tracks(names: player.audioTrackNames, ids: player.audioTrackIndexes, current: player.currentAudioTrackIndex)
        let text = tracks(names: player.videoSubTitlesNames, ids: player.videoSubTitlesIndexes, current: player.currentVideoSubTitleIndex)

        // VLC turns on a file's default subtitles by itself; the "off" setting wins.
        if subtitleLanguage == "off" && !subtitleChecked && !text.isEmpty {
            subtitleChecked = true
            player.currentVideoSubTitleIndex = -1
        }
        let key = "\(audio)|\(text)"
        guard force || key != lastTracks else { return }
        lastTracks = key
        emitEvent("tracks", ["audio": audio, "text": text])
    }

    // VLC names tracks like "Track 1 - [Persian]": keep the useful part, drop a bare "Track 1".
    private func label(_ name: String) -> String {
        var text = name.replacingOccurrences(of: #"^Track \d+( - )?"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: "[", with: "").replacingOccurrences(of: "]", with: "")
        return text.trimmingCharacters(in: .whitespaces)
    }

    private func emitEvent(_ name: String, _ fields: [String: Any]) {
        var event = fields
        event["type"] = "player"
        event["event"] = name
        emit(event)
    }

    private func rgb(_ hex: String) -> Int {
        Int(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0xFFFFFF
    }
}
