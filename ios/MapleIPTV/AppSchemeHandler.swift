import UniformTypeIdentifiers
import WebKit

/// Serves the bundled interface as maple://app/… and, like the Android app's HttpProxy,
/// maple://app/proxy?url=…&ua=… so playlists and program guides from IPTV servers (plain
/// http, no CORS headers) can be loaded by the page. Video doesn't come through here:
/// VLC opens streams itself.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler, URLSessionDataDelegate {
    static let scheme = "maple"

    private struct Pending {
        let page: WKURLSchemeTask
        let url: URL
    }

    private let root = Bundle.main.resourceURL!.appendingPathComponent("web").standardizedFileURL
    // Callbacks on the main queue: page tasks are touched only there (calling one after it was stopped crashes).
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
    private var pending: [Int: Pending] = [:] // URLSession task id → page request
    private var running: [ObjectIdentifier: URLSessionTask] = [:]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return respond(task, status: 400) }
        if url.path == "/proxy" {
            proxy(task, url: url)
        } else {
            serveFile(task, url: url)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        guard let upstream = running.removeValue(forKey: ObjectIdentifier(task)) else { return }
        pending.removeValue(forKey: upstream.taskIdentifier)
        upstream.cancel()
    }

    // MARK: - The interface

    private func serveFile(_ task: WKURLSchemeTask, url: URL) {
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            return respond(task, status: 404)
        }
        var type = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        if type.hasPrefix("text/") || type.hasSuffix("javascript") || type.hasSuffix("json") { type += "; charset=utf-8" }
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": type, "Content-Length": "\(data.count)", "Cache-Control": "no-store"])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func respond(_ task: WKURLSchemeTask, status: Int) {
        task.didReceive(HTTPURLResponse(url: task.request.url ?? URL(string: "\(Self.scheme)://app/")!, statusCode: status,
                                        httpVersion: "HTTP/1.1", headerFields: ["Content-Length": "0"])!)
        task.didFinish()
    }

    // MARK: - The proxy

    private func proxy(_ task: WKURLSchemeTask, url: URL) {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard let target = items.first(where: { $0.name == "url" })?.value, let targetURL = URL(string: target),
              ["http", "https"].contains(targetURL.scheme?.lowercased() ?? "") else {
            return respond(task, status: 400)
        }
        var request = URLRequest(url: targetURL, timeoutInterval: 60)
        if let ua = items.first(where: { $0.name == "ua" })?.value, !ua.isEmpty {
            request.setValue(ua, forHTTPHeaderField: "User-Agent")
        }
        if let range = task.request.value(forHTTPHeaderField: "Range") {
            request.setValue(range, forHTTPHeaderField: "Range")
        }
        let upstream = session.dataTask(with: request)
        pending[upstream.taskIdentifier] = Pending(page: task, url: url)
        running[ObjectIdentifier(task)] = upstream
        upstream.resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let entry = pending[dataTask.taskIdentifier], let http = response as? HTTPURLResponse else {
            return completionHandler(.cancel)
        }
        var headers = [
            "Content-Type": http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream",
            "Cache-Control": "no-store",
        ]
        for name in ["Content-Range", "Accept-Ranges"] {
            if let value = http.value(forHTTPHeaderField: name) { headers[name] = value }
        }
        // URLSession has already unzipped compressed bodies, so their length no longer matches.
        if http.value(forHTTPHeaderField: "Content-Encoding") == nil, let length = http.value(forHTTPHeaderField: "Content-Length") {
            headers["Content-Length"] = length
        }
        entry.page.didReceive(HTTPURLResponse(url: entry.url, statusCode: http.statusCode, httpVersion: "HTTP/1.1", headerFields: headers)!)
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        pending[dataTask.taskIdentifier]?.page.didReceive(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let entry = pending.removeValue(forKey: task.taskIdentifier) else { return }
        running.removeValue(forKey: ObjectIdentifier(entry.page))
        if let error = error {
            entry.page.didFailWithError(error) // the page reports a network problem
        } else {
            entry.page.didFinish()
        }
    }
}
