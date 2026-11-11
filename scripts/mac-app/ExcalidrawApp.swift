import Cocoa
import Darwin
import UniformTypeIdentifiers
import WebKit

// MARK: - Embedded Loopback HTTP Server

final class LoopbackHTTPServer {
    let webRoot: URL
    private(set) var port: UInt16 = 0

    private var serverFD: Int32 = -1
    private var isRunning = false
    private let acceptQueue = DispatchQueue(label: "com.excalidraw.macapp.http.accept")
    private let requestQueue = DispatchQueue(label: "com.excalidraw.macapp.http.request", attributes: .concurrent)

    private let filesLock = NSLock()
    private var openedFiles: [String: URL] = [:]

    init(webRoot: URL) {
        self.webRoot = webRoot.standardizedFileURL
    }

    func start() throws -> UInt16 {
        signal(SIGPIPE, SIG_IGN)

        // Try deterministic ports first so http://127.0.0.1:<port> stays consistent
        // across launches and preserves Excalidraw's localStorage/IndexedDB scene.
        let candidatePorts: [UInt16] = [49191, 49192, 49193, 49194, 49195, 0]
        for candidate in candidatePorts {
            if let boundPort = tryBind(port: candidate) {
                port = boundPort
                isRunning = true
                acceptQueue.async { [weak self] in
                    self?.acceptLoop()
                }
                return boundPort
            }
        }

        throw NSError(
            domain: "LoopbackHTTPServer",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Failed to bind loopback HTTP port."]
        )
    }

    func stop() {
        isRunning = false
        if serverFD >= 0 {
            Darwin.close(serverFD)
            serverFD = -1
        }
    }

    func registerOpenFile(_ url: URL) -> String {
        let id = UUID().uuidString.lowercased()
        filesLock.lock()
        openedFiles[id] = url
        filesLock.unlock()
        return id
    }

    private func registeredOpenFile(for id: String) -> URL? {
        filesLock.lock()
        defer { filesLock.unlock() }
        return openedFiles[id]
    }

    private func tryBind(port: UInt16) -> UInt16? {
        let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }

        var reuse: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        let bindResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.bind(fd, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }

        guard bindResult == 0, Darwin.listen(fd, 128) == 0 else {
            Darwin.close(fd)
            return nil
        }

        var assignedAddr = sockaddr_in()
        var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &assignedAddr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.getsockname(fd, sockPtr, &addrLen)
            }
        }

        guard nameResult == 0 else {
            Darwin.close(fd)
            return nil
        }

        serverFD = fd
        return UInt16(bigEndian: assignedAddr.sin_port)
    }

    private func acceptLoop() {
        while isRunning && serverFD >= 0 {
            var clientAddr = sockaddr_in()
            var clientLen = socklen_t(MemoryLayout<sockaddr_in>.size)
            let clientFD = withUnsafeMutablePointer(to: &clientAddr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                    Darwin.accept(serverFD, sockPtr, &clientLen)
                }
            }

            if clientFD < 0 {
                if errno == EINTR { continue }
                break
            }

            requestQueue.async { [weak self] in
                self?.handleClient(fd: clientFD)
            }
        }
    }

    private func handleClient(fd: Int32) {
        defer { Darwin.close(fd) }

        var nosigpipe: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &nosigpipe, socklen_t(MemoryLayout<Int32>.size))

        guard let requestLine = readRequestLine(from: fd) else {
            sendResponse(fd: fd, status: "400 Bad Request", contentType: "text/plain; charset=utf-8", body: Data("Bad Request".utf8), includeBody: true)
            return
        }

        let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count >= 2 else {
            sendResponse(fd: fd, status: "400 Bad Request", contentType: "text/plain; charset=utf-8", body: Data("Bad Request".utf8), includeBody: true)
            return
        }

        let method = String(parts[0]).uppercased()
        let rawTarget = String(parts[1])

        guard method == "GET" || method == "HEAD" else {
            sendResponse(fd: fd, status: "405 Method Not Allowed", contentType: "text/plain; charset=utf-8", body: Data("Method Not Allowed".utf8), includeBody: true)
            return
        }

        let includeBody = (method == "GET")
        let targetParts = rawTarget.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let rawPath = String(targetParts[0])
        let rawQuery = targetParts.count > 1 ? String(targetParts[1]) : ""

        if rawPath == "/__open-file" {
            handleOpenFileEndpoint(fd: fd, query: rawQuery, includeBody: includeBody)
            return
        }

        // Neutralize Workbox/Service Worker caching so the embedded bundle is always fresh.
        if rawPath == "/sw.js" || rawPath == "/service-worker.js" {
            let swScript = """
            self.addEventListener("install", () => self.skipWaiting());
            self.addEventListener("activate", async () => {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
              await self.registration.unregister();
            });
            """
            sendResponse(
                fd: fd,
                status: "200 OK",
                contentType: "application/javascript; charset=utf-8",
                body: Data(swScript.utf8),
                includeBody: includeBody,
                cacheControl: "no-store"
            )
            return
        }

        guard let decodedPath = rawPath.removingPercentEncoding else {
            sendResponse(fd: fd, status: "400 Bad Request", contentType: "text/plain; charset=utf-8", body: Data("Invalid Path".utf8), includeBody: includeBody)
            return
        }

        let trimmed = decodedPath.hasPrefix("/") ? String(decodedPath.dropFirst()) : decodedPath
        var candidateURL = trimmed.isEmpty
            ? webRoot.appendingPathComponent("index.html")
            : webRoot.appendingPathComponent(trimmed).standardizedFileURL

        let rootPath = webRoot.path
        guard candidateURL.path == rootPath || candidateURL.path.hasPrefix(rootPath + "/") else {
            sendResponse(fd: fd, status: "403 Forbidden", contentType: "text/plain; charset=utf-8", body: Data("Forbidden".utf8), includeBody: includeBody)
            return
        }

        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: candidateURL.path, isDirectory: &isDir) {
            if isDir.boolValue {
                candidateURL = candidateURL.appendingPathComponent("index.html")
            }
        } else if candidateURL.pathExtension.isEmpty {
            candidateURL = webRoot.appendingPathComponent("index.html")
        }

        guard FileManager.default.fileExists(atPath: candidateURL.path, isDirectory: &isDir),
              !isDir.boolValue,
              let data = try? Data(contentsOf: candidateURL)
        else {
            sendResponse(fd: fd, status: "404 Not Found", contentType: "text/plain; charset=utf-8", body: Data("Not Found".utf8), includeBody: includeBody)
            return
        }

        let cachePolicy = (candidateURL.lastPathComponent == "index.html") ? "no-store" : "no-cache"
        sendResponse(
            fd: fd,
            status: "200 OK",
            contentType: mimeType(for: candidateURL.pathExtension),
            body: data,
            includeBody: includeBody,
            cacheControl: cachePolicy
        )
    }

    private func handleOpenFileEndpoint(fd: Int32, query: String, includeBody: Bool) {
        let components = URLComponents(string: "http://localhost/?" + query)
        guard let id = components?.queryItems?.first(where: { $0.name == "id" })?.value,
              let fileURL = registeredOpenFile(for: id),
              let data = try? Data(contentsOf: fileURL)
        else {
            sendResponse(fd: fd, status: "404 Not Found", contentType: "text/plain; charset=utf-8", body: Data("File not found".utf8), includeBody: includeBody)
            return
        }

        sendResponse(
            fd: fd,
            status: "200 OK",
            contentType: "application/json; charset=utf-8",
            body: data,
            includeBody: includeBody,
            cacheControl: "no-store"
        )
    }

    private func readRequestLine(from fd: Int32) -> String? {
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        let headerTerminator = Data([13, 10, 13, 10]) // \r\n\r\n

        while buffer.count < 65536 {
            let bytesRead = Darwin.recv(fd, &chunk, chunk.count, 0)
            if bytesRead <= 0 { break }
            buffer.append(chunk, count: bytesRead)
            if buffer.range(of: headerTerminator) != nil { break }
        }

        guard let headerString = String(data: buffer, encoding: .utf8),
              let lineEnd = headerString.range(of: "\r\n") ?? headerString.range(of: "\n")
        else {
            return nil
        }

        return String(headerString[..<lineEnd.lowerBound])
    }

    private func sendResponse(
        fd: Int32,
        status: String,
        contentType: String,
        body: Data,
        includeBody: Bool,
        cacheControl: String = "no-cache"
    ) {
        let headers = [
            "HTTP/1.1 \(status)",
            "Content-Type: \(contentType)",
            "Content-Length: \(body.count)",
            "Cache-Control: \(cacheControl)",
            "Access-Control-Allow-Origin: *",
            "Connection: close",
            "",
            "",
        ].joined(separator: "\r\n")

        writeAll(fd: fd, data: Data(headers.utf8))
        if includeBody && !body.isEmpty {
            writeAll(fd: fd, data: body)
        }
    }

    private func writeAll(fd: Int32, data: Data) {
        data.withUnsafeBytes { rawBuffer in
            guard let base = rawBuffer.baseAddress else { return }
            var totalSent = 0
            while totalSent < data.count {
                let sent = Darwin.send(fd, base.advanced(by: totalSent), data.count - totalSent, 0)
                if sent <= 0 {
                    if errno == EINTR { continue }
                    break
                }
                totalSent += sent
            }
        }
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "application/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest", "map": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "wasm": return "application/wasm"
        case "txt": return "text/plain; charset=utf-8"
        case "xml": return "application/xml; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}

// MARK: - Library Browser Popup Delegate

@MainActor
final class LibraryPopupController: NSObject, NSWindowDelegate, WKNavigationDelegate {
    let window: NSWindow
    let webView: WKWebView
    private let localOriginPrefix: String
    private let onImportURL: (URL) -> Void
    private let onClose: (LibraryPopupController) -> Void

    init(
        configuration: WKWebViewConfiguration,
        localOriginPrefix: String,
        onImportURL: @escaping (URL) -> Void,
        onClose: @escaping (LibraryPopupController) -> Void
    ) {
        self.localOriginPrefix = localOriginPrefix
        self.onImportURL = onImportURL
        self.onClose = onClose

        self.webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 740), configuration: configuration)
        self.window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1024, height: 740),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        super.init()

        window.title = "Excalidraw Libraries"
        window.contentView = webView
        window.center()
        window.delegate = self
        webView.navigationDelegate = self
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url,
           url.absoluteString.hasPrefix(localOriginPrefix) {
            decisionHandler(.cancel)
            onImportURL(url)
            window.close()
            return
        }
        decisionHandler(.allow)
    }

    func windowWillClose(_ notification: Notification) {
        onClose(self)
    }
}

// MARK: - Main Application Delegate

@MainActor
final class ExcalidrawAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate {
    private var server: LoopbackHTTPServer!
    private var baseURLString: String = ""
    private var window: NSWindow!
    private var webView: WKWebView!
    private var isInitialLoadComplete = false
    private var pendingOpenURLs: [URL] = []
    private var activePopups: [LibraryPopupController] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let webRoot = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true),
              FileManager.default.fileExists(atPath: webRoot.appendingPathComponent("index.html").path)
        else {
            showFatalAlert("Missing embedded Excalidraw web assets in application bundle.")
            NSApp.terminate(nil)
            return
        }

        server = LoopbackHTTPServer(webRoot: webRoot)
        let port: UInt16
        do {
            port = try server.start()
        } catch {
            showFatalAlert("Failed to start local Excalidraw server: \(error.localizedDescription)")
            NSApp.terminate(nil)
            return
        }

        baseURLString = "http://127.0.0.1:\(port)"

        setupMainMenu()
        setupWindowAndWebView()
        loadApp()
    }

    func applicationWillTerminate(_ notification: Notification) {
        server?.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window?.makeKeyAndOrderFront(nil)
        }
        return true
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where url.isFileURL {
            if isInitialLoadComplete {
                openLocalExcalidrawFile(url)
            } else {
                pendingOpenURLs.append(url)
            }
        }
        window?.makeKeyAndOrderFront(nil)
    }

    // MARK: - Setup

    private func setupWindowAndWebView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        let initialRect = NSRect(x: 0, y: 0, width: 1320, height: 860)
        window = NSWindow(
            contentRect: initialRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Excalidraw"
        window.minSize = NSSize(width: 720, height: 500)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("ExcalidrawMainWindow")

        webView = WKWebView(frame: window.contentView?.bounds ?? initialRect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self

        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func loadApp() {
        guard let url = URL(string: baseURLString + "/") else { return }
        webView.load(URLRequest(url: url))
    }

    private func setupMainMenu() {
        let mainMenu = NSMenu()

        // App menu
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu(title: "Excalidraw")
        appMenu.addItem(withTitle: "About Excalidraw", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Excalidraw", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthersItem = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthersItem.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Excalidraw", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu

        // File menu
        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        // Intentionally omit Cmd+O / Cmd+S key equivalents so Excalidraw handles them directly in canvas.
        fileMenu.addItem(withTitle: "Open .excalidraw File...", action: #selector(openFileFromMenu(_:)), keyEquivalent: "")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileMenuItem.submenu = fileMenu

        // Edit menu (required for native text-input clipboard & editing shortcuts in WKWebView)
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redoItem = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu

        // View menu
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reloadWebView(_:)), keyEquivalent: "r")
        viewMenu.addItem(.separator())
        let fullScreenItem = viewMenu.addItem(withTitle: "Toggle Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreenItem.keyEquivalentModifierMask = [.command, .control]
        viewMenuItem.submenu = viewMenu

        // Window menu
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.zoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Excalidraw", action: #selector(showMainWindow(_:)), keyEquivalent: "")
        windowMenuItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    @objc private func openFileFromMenu(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [
            UTType(filenameExtension: "excalidraw") ?? .json,
            UTType(filenameExtension: "excalidrawlib") ?? .json,
            .json,
        ]

        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            self?.openLocalExcalidrawFile(url)
        }
    }

    @objc private func reloadWebView(_ sender: Any?) {
        webView.reload()
    }

    @objc private func showMainWindow(_ sender: Any?) {
        window.makeKeyAndOrderFront(nil)
    }

    // MARK: - Open File Integration

    private func openLocalExcalidrawFile(_ fileURL: URL) {
        let id = server.registerOpenFile(fileURL)
        let endpoint = "\(baseURLString)/__open-file?id=\(id)"
        let ext = fileURL.pathExtension.lowercased()

        if ext == "excalidrawlib" {
            let safeName = fileURL.lastPathComponent
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
            let js = """
            (async () => {
              const res = await fetch('\(endpoint)');
              const blob = await res.blob();
              const file = new File([blob], '\(safeName)', { type: 'application/vnd.excalidrawlib+json' });
              const dt = new DataTransfer();
              dt.items.add(file);
              const target = document.querySelector('.excalidraw') || document.body;
              target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
            })();
            """
            webView.evaluateJavaScript(js, completionHandler: nil)
            return
        }

        var unreserved = CharacterSet.alphanumerics
        unreserved.insert(charactersIn: "-._~")
        let encoded = endpoint.addingPercentEncoding(withAllowedCharacters: unreserved) ?? endpoint
        let js = "window.location.hash = '#url=\(encoded)';"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - NSWindowDelegate

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === window {
            sender.orderOut(nil)
            return false
        }
        return true
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isInitialLoadComplete = true
        if !pendingOpenURLs.isEmpty {
            let queued = pendingOpenURLs
            pendingOpenURLs.removeAll()
            for url in queued {
                openLocalExcalidrawFile(url)
            }
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        preferences: WKWebpagePreferences,
        decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download, preferences)
            return
        }

        if let url = navigationAction.request.url {
            let scheme = url.scheme?.lowercased() ?? ""
            let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
            if scheme == "http" || scheme == "https" {
                if !url.absoluteString.hasPrefix(baseURLString) && isMainFrame {
                    NSWorkspace.shared.open(url)
                    decisionHandler(.cancel, preferences)
                    return
                }
            } else if scheme != "blob" && scheme != "data" && scheme != "about" && isMainFrame {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel, preferences)
                return
            }
        }

        decisionHandler(.allow, preferences)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    // MARK: - WKUIDelegate

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection

        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Excalidraw"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in
            completionHandler()
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Excalidraw"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "Excalidraw"
        alert.informativeText = prompt
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        input.stringValue = defaultText ?? ""
        alert.accessoryView = input
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn ? input.stringValue : nil)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }

        // Keep libraries.excalidraw.com in-app so "Add to Excalidraw" seamlessly loads back into the canvas.
        if url.host == "libraries.excalidraw.com" {
            let popup = LibraryPopupController(
                configuration: configuration,
                localOriginPrefix: baseURLString,
                onImportURL: { [weak self] importURL in
                    guard let self else { return }
                    if let fragment = importURL.fragment {
                        let escaped = fragment.replacingOccurrences(of: "\\", with: "\\\\")
                            .replacingOccurrences(of: "'", with: "\\'")
                        self.webView.evaluateJavaScript("window.location.hash = '#\(escaped)';", completionHandler: nil)
                    } else {
                        self.webView.load(URLRequest(url: importURL))
                    }
                    self.window.makeKeyAndOrderFront(nil)
                },
                onClose: { [weak self] closed in
                    self?.activePopups.removeAll { $0 === closed }
                }
            )
            activePopups.append(popup)
            popup.window.makeKeyAndOrderFront(nil)
            return popup.webView
        }

        NSWorkspace.shared.open(url)
        return nil
    }

    // MARK: - WKDownloadDelegate

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                completionHandler(nil)
                return
            }

            let panel = NSSavePanel()
            panel.canCreateDirectories = true
            panel.nameFieldStringValue = suggestedFilename

            panel.beginSheetModal(for: self.window) { result in
                guard result == .OK, let destinationURL = panel.url else {
                    completionHandler(nil)
                    return
                }

                // WKDownload errors if destination already exists even after user confirmed overwrite in NSSavePanel.
                if FileManager.default.fileExists(atPath: destinationURL.path) {
                    try? FileManager.default.removeItem(at: destinationURL)
                }

                completionHandler(destinationURL)
            }
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.showAlert(title: "Save Failed", message: error.localizedDescription)
        }
    }

    // MARK: - Alerts

    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        if let window {
            alert.beginSheetModal(for: window, completionHandler: nil)
        } else {
            alert.runModal()
        }
    }

    private func showFatalAlert(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Excalidraw"
        alert.informativeText = message
        alert.addButton(withTitle: "Quit")
        alert.runModal()
    }
}

// MARK: - Entrypoint

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let delegate = ExcalidrawAppDelegate()
    app.delegate = delegate
    withExtendedLifetime(delegate) {
        app.run()
    }
}
