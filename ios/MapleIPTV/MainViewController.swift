import UIKit
import WebKit

/// Hosts the shared interface (the top-level web/ folder, bundled as "web") in a
/// transparent WKWebView, with VLC drawing the video in a view underneath it: the
/// iPhone/iPad counterpart of the Android app's MainActivity.
///
/// The page gets the same window.AndroidHost bridge as on Android (HostScript), so the
/// shared code treats both alike; window.MapleIos marks where Apple's rules differ
/// (purchases: App Store only, see web/js/screens/premium.js).
final class MainViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate {
    private var webView: WKWebView!
    private let videoView = UIView()
    private var player: NativePlayer!
    private var billing: Billing!
    /// Where the page wants the video (points, relative to the web view); nil = full screen.
    private var videoRect: CGRect?

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        videoView.backgroundColor = .black
        videoView.isUserInteractionEnabled = false
        view.addSubview(videoView)

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: AppSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.add(WeakMessageHandler(self), name: "host")
        config.userContentController.addUserScript(WKUserScript(source: HostScript.source(), injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view.addSubview(webView)

        player = NativePlayer(view: videoView) { [weak self] event in self?.send(event) }
        billing = Billing { [weak self] event in self?.send(event) }
        webView.load(URLRequest(url: URL(string: "\(AppSchemeHandler.scheme)://app/index.html")!))

        NotificationCenter.default.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // The interface keeps clear of the notch and the home bar; full-screen video uses it all.
        webView.frame = view.bounds.inset(by: view.safeAreaInsets)
        layoutVideo()
    }

    private func layoutVideo() {
        if let rect = videoRect {
            videoView.frame = rect.offsetBy(dx: webView.frame.minX, dy: webView.frame.minY)
        } else {
            videoView.frame = view.bounds
        }
        player.viewResized()
    }

    @objc private func didEnterBackground() {
        player.onBackground()
    }

    @objc private func willEnterForeground() {
        player.onForeground()
        billing.start()
    }

    /// Delivers an event to the page; see window.__nativeEvent in web/js/keys.js.
    private func send(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__nativeEvent && window.__nativeEvent(\(json))", completionHandler: nil)
    }

    // MARK: - Calls from the page (window.AndroidHost in HostScript)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else { return }
        let args = body["args"] as? [Any] ?? []
        func string(_ i: Int) -> String {
            guard i < args.count else { return "" }
            return args[i] as? String ?? "\(args[i])"
        }
        func number(_ i: Int) -> Double {
            guard i < args.count else { return 0 }
            return (args[i] as? NSNumber)?.doubleValue ?? Double(string(i)) ?? 0
        }

        switch method {
        case "play":
            let headers = (try? JSONSerialization.jsonObject(with: Data(string(1).utf8))) as? [String: String] ?? [:]
            player.play(url: string(0), headers: headers, startMs: number(2))
        case "stop": player.stop()
        case "pause": player.pause()
        case "resume": player.resume()
        case "seekTo": player.seekTo(number(0))
        case "selectTrack": player.selectTrack(type: string(0), id: string(1))
        case "setSubtitleLanguage": player.setSubtitleLanguage(string(0))
        case "setSubtitleStyle":
            let style = (try? JSONSerialization.jsonObject(with: Data(string(0).utf8))) as? [String: Any] ?? [:]
            player.setSubtitleStyle(
                size: (style["size"] as? NSNumber)?.doubleValue ?? 1,
                color: style["color"] as? String ?? "#ffffff",
                background: style["background"] as? String ?? "shadow",
                font: style["font"] as? String ?? "default")
        case "setResizeMode": player.setResizeMode(string(0))
        case "setVideoRect":
            let rect = CGRect(x: number(0), y: number(1), width: number(2), height: number(3))
            videoRect = rect.width > 0 && rect.height > 0 ? rect : nil
            layoutVideo()
        case "billingStart": billing.start()
        case "billingBuy": billing.buy(string(0))
        case "billingRestore": billing.restore()
        case "openUrl":
            if let url = URL(string: string(0)), ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
        default:
            break
        }
    }

    // Only the bundled interface opens in the web view.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        action.request.url?.scheme == AppSchemeHandler.scheme ? .allow : .cancel
    }

    // The web content process can be ended by the system under memory pressure: reload.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        player.stop()
        webView.reload()
    }
}

/// WKUserContentController keeps its handlers strongly; this breaks the cycle with the controller.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
