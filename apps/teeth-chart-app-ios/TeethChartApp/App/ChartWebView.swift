import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct ChartWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // localStorage remains an offline fallback. The data-folder bridge below
        // can additionally keep desktop-compatible JSON files in Files.
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(context.coordinator, name: "exportFile")
        configuration.userContentController.add(context.coordinator, name: "dataFolder")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView
        webView.navigationDelegate = context.coordinator
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear

        guard let indexURL = Bundle.main.url(
            forResource: "index",
            withExtension: "html",
            subdirectory: "Web"
        ) else {
            assertionFailure("Missing bundled Web/index.html")
            return webView
        }

        webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "exportFile")
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "dataFolder")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, UIDocumentPickerDelegate {
        weak var webView: WKWebView?

        private let bookmarkKey = "TeethChartApp.dataFolderBookmark.v1"
        private let fileSuffix = ".json"

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(url.isFileURL || url.scheme == "about" ? .allow : .cancel)
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let payload = message.body as? [String: Any] else { return }
            if message.name == "exportFile" {
                exportFile(payload)
            } else if message.name == "dataFolder" {
                handleDataFolderMessage(payload)
            }
        }

        private func exportFile(_ payload: [String: Any]) {
            guard let requestedName = payload["filename"] as? String, let text = payload["text"] as? String else { return }
            let filename = sanitizedFilename(requestedName, fallback: "Teeth-Chart.json")
            let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
            do {
                try text.write(to: fileURL, atomically: true, encoding: .utf8)
                let picker = UIDocumentPickerViewController(forExporting: [fileURL], asCopy: true)
                Self.topViewController()?.present(picker, animated: true)
            } catch {
                sendError(action: "export", error: error)
            }
        }

        private func handleDataFolderMessage(_ payload: [String: Any]) {
            guard let action = payload["action"] as? String else { return }
            switch action {
            case "choose":
                let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
                picker.delegate = self
                picker.allowsMultipleSelection = false
                Self.topViewController()?.present(picker, animated: true)
            case "status":
                guard let folderURL = resolveFolder() else {
                    send(["event": "status", "available": false])
                    return
                }
                sendStatus(for: folderURL)
            case "list":
                withFolder(action: action) { folderURL in
                    let urls = try FileManager.default.contentsOfDirectory(
                        at: folderURL,
                        includingPropertiesForKeys: [.isRegularFileKey],
                        options: [.skipsHiddenFiles]
                    )
                    let files: [[String: String]] = try urls
                        .filter {
                            $0.lastPathComponent.lowercased().hasSuffix(self.fileSuffix)
                                && (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
                        }
                        .sorted { $0.lastPathComponent.localizedCaseInsensitiveCompare($1.lastPathComponent) == .orderedAscending }
                        .map { ["filename": $0.lastPathComponent, "text": try String(contentsOf: $0, encoding: .utf8)] }
                    self.send(["event": "files", "files": files])
                }
            case "write":
                guard let requestedName = payload["filename"] as? String, let text = payload["text"] as? String else { return }
                let filename = sanitizedFilename(requestedName, fallback: "teeth_chart.json")
                guard filename.lowercased().hasSuffix(fileSuffix) else {
                    send(["event": "error", "action": action, "message": "Chart files must end in .json."])
                    return
                }
                withFolder(action: action) { folderURL in
                    try text.write(to: folderURL.appendingPathComponent(filename), atomically: true, encoding: .utf8)
                    self.send(["event": "write", "filename": filename])
                }
            case "delete":
                guard let requestedName = payload["filename"] as? String else { return }
                let filename = sanitizedFilename(requestedName, fallback: "")
                guard !filename.isEmpty, filename.lowercased().hasSuffix(fileSuffix) else { return }
                withFolder(action: action) { folderURL in
                    let fileURL = folderURL.appendingPathComponent(filename)
                    if FileManager.default.fileExists(atPath: fileURL.path) {
                        try FileManager.default.removeItem(at: fileURL)
                    }
                    self.send(["event": "delete", "filename": filename])
                }
            default:
                break
            }
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let folderURL = urls.first else { return }
            let accessed = folderURL.startAccessingSecurityScopedResource()
            defer { if accessed { folderURL.stopAccessingSecurityScopedResource() } }
            do {
                let bookmark = try folderURL.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
                UserDefaults.standard.set(bookmark, forKey: bookmarkKey)
                sendStatus(for: folderURL)
            } catch {
                sendError(action: "choose", error: error)
            }
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            send(["event": "cancelled"])
        }

        private func resolveFolder() -> URL? {
            guard let bookmark = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
            var stale = false
            do {
                let url = try URL(
                    resolvingBookmarkData: bookmark,
                    options: [.withoutUI, .withoutImplicitStartAccessing],
                    relativeTo: nil,
                    bookmarkDataIsStale: &stale
                )
                if stale {
                    let refreshed = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
                    UserDefaults.standard.set(refreshed, forKey: bookmarkKey)
                }
                return url
            } catch {
                UserDefaults.standard.removeObject(forKey: bookmarkKey)
                return nil
            }
        }

        private func withFolder(action: String, operation: (URL) throws -> Void) {
            guard let folderURL = resolveFolder() else {
                send(["event": "status", "available": false])
                return
            }
            let accessed = folderURL.startAccessingSecurityScopedResource()
            defer { if accessed { folderURL.stopAccessingSecurityScopedResource() } }
            do {
                try operation(folderURL)
            } catch {
                sendError(action: action, error: error)
            }
        }

        private func sendStatus(for folderURL: URL) {
            send(["event": "status", "available": true, "folderName": folderURL.lastPathComponent])
        }

        private func sendError(action: String, error: Error) {
            send(["event": "error", "action": action, "message": error.localizedDescription])
        }

        private func send(_ payload: [String: Any]) {
            guard
                JSONSerialization.isValidJSONObject(payload),
                let data = try? JSONSerialization.data(withJSONObject: payload),
                let json = String(data: data, encoding: .utf8)
            else { return }
            DispatchQueue.main.async { [weak self] in
                self?.webView?.evaluateJavaScript("window.nativeFolderStorage?.receive(\(json));")
            }
        }

        private func sanitizedFilename(_ requestedName: String, fallback: String) -> String {
            let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_. "))
            let value = requestedName.unicodeScalars
                .map { allowed.contains($0) ? String($0) : "-" }
                .joined()
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? fallback : value
        }

        private static func topViewController(
            from root: UIViewController? = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first { $0.isKeyWindow }?
                .rootViewController
        ) -> UIViewController? {
            if let presented = root?.presentedViewController { return topViewController(from: presented) }
            if let navigation = root as? UINavigationController { return topViewController(from: navigation.visibleViewController) }
            if let tabs = root as? UITabBarController { return topViewController(from: tabs.selectedViewController) }
            return root
        }
    }
}
