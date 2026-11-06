import Security
import UIKit

/// The script added to the page before it loads: window.AndroidHost with the same methods
/// as the Android app's bridge (MainActivity.PageBridge), so the shared interface runs as is.
/// Calls go to MainViewController as "host" messages; values the page reads synchronously
/// (version, device, trial start) are written into the script.
enum HostScript {
    static func source() -> String {
        let info: [String: Any] = [
            "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "device": [
                "maker": "Apple",
                "model": modelIdentifier(),
                "os": "iOS " + UIDevice.current.systemVersion,
                "tv": false,
                "platform": UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone",
            ],
            "trialStart": TrialStore.start(),
        ]
        let json = String(data: try! JSONSerialization.data(withJSONObject: info), encoding: .utf8)!
        return """
        (function () {
          var info = \(json);
          var post = function (method, args) {
            window.webkit.messageHandlers.host.postMessage({ method: method, args: args || [] });
          };
          window.MapleIos = true;
          window.AndroidHost = {
            play: function (url, headers, startMs) { post('play', [url, headers, startMs]); },
            stop: function () { post('stop'); },
            pause: function () { post('pause'); },
            resume: function () { post('resume'); },
            seekTo: function (ms) { post('seekTo', [ms]); },
            selectTrack: function (type, id) { post('selectTrack', [type, id]); },
            setSubtitleLanguage: function (language) { post('setSubtitleLanguage', [language]); },
            setSubtitleStyle: function (json) { post('setSubtitleStyle', [json]); },
            setResizeMode: function (mode) { post('setResizeMode', [mode]); },
            // Android wants screen pixels (page pixels x devicePixelRatio); iOS lays out in points = page pixels.
            setVideoRect: function (x, y, width, height) {
              var d = window.devicePixelRatio || 1;
              post('setVideoRect', [x / d, y / d, width / d, height / d]);
            },
            billingStart: function () { post('billingStart'); },
            billingBuy: function (planId) { post('billingBuy', [planId]); },
            billingRestore: function () { post('billingRestore'); },
            trialStart: function () { return info.trialStart; },
            openUrl: function (url) { post('openUrl', [url]); },
            showKeyboard: function () {},
            hideKeyboard: function () {},
            exitApp: function () {},
            appVersion: function () { return info.version; },
            deviceInfo: function () { return JSON.stringify(info.device); },
            hasTouchscreen: function () { return true; },
          };
        })();
        """
    }

    /// e.g. "iPhone15,2" (the App Store and support pages map these to names).
    private static func modelIdentifier() -> String {
        var system = utsname()
        uname(&system)
        let machine = withUnsafeBytes(of: &system.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
        return machine.isEmpty ? UIDevice.current.model : machine
    }
}

/// When the free trial began (ms since 1970), kept in the Keychain: unlike app data it
/// survives deleting and reinstalling the app, as the Android app's trial does.
enum TrialStore {
    private static let service = "com.mapleonlinesolutions.iptv"
    private static let account = "trialStart"

    static func start() -> Double {
        if let saved = read() { return saved }
        let now = (Date().timeIntervalSince1970 * 1000).rounded()
        write(now)
        return now
    }

    private static func read() -> Double? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, let text = String(data: data, encoding: .utf8) else { return nil }
        return Double(text)
    }

    private static func write(_ value: Double) {
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: Data(String(format: "%.0f", value).utf8),
        ]
        SecItemAdd(item as CFDictionary, nil)
    }
}
