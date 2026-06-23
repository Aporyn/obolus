import Foundation

/// A minimal Server-Sent Events parser. Pure and synchronous so it can be unit-tested
/// without a network. Feed it raw response chunks; it returns the `data:` payloads of any
/// events completed by that chunk, buffering partial events across calls.
public struct SSEParser {
    private var buffer = ""

    public init() {}

    public mutating func feed(_ chunk: String) -> [String] {
        // Normalize line endings so the blank-line event delimiter is always "\n\n".
        buffer += chunk.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var payloads: [String] = []
        while let range = buffer.range(of: "\n\n") {
            let rawEvent = String(buffer[..<range.lowerBound])
            buffer.removeSubrange(buffer.startIndex..<range.upperBound)
            if let data = Self.dataField(from: rawEvent) { payloads.append(data) }
        }
        return payloads
    }

    /// Extract the concatenated `data:` field from one raw event block (ignores `:` comments).
    static func dataField(from event: String) -> String? {
        var dataLines: [String] = []
        for line in event.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix(":") { continue }
            if line.hasPrefix("data:") {
                var value = String(line.dropFirst("data:".count))
                if value.hasPrefix(" ") { value.removeFirst() }
                dataLines.append(value)
            }
        }
        return dataLines.isEmpty ? nil : dataLines.joined(separator: "\n")
    }
}

/// Streams `LiveRunEvent`s from `GET /api/events`. Reports connection state so the UI can
/// distinguish "live and tracking" from "not capturing right now".
public final class LiveEventStream: NSObject, URLSessionDataDelegate {
    public var onConnected: (() -> Void)?
    public var onDisconnected: (() -> Void)?
    public var onEvent: ((LiveRunEvent) -> Void)?

    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var parser = SSEParser()
    private let decoder = JSONDecoder()

    public override init() { super.init() }

    public func start(url: URL) {
        stop()
        parser = SSEParser()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = TimeInterval(Int.max) // long-lived stream
        config.timeoutIntervalForResource = TimeInterval(Int.max)
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let task = session.dataTask(with: request)
        self.session = session
        self.task = task
        task.resume()
    }

    public func stop() {
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
    }

    // MARK: URLSessionDataDelegate

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                           didReceive response: URLResponse,
                           completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        let ok = (response as? HTTPURLResponse)?.statusCode == 200
        if ok { dispatchMain { self.onConnected?() } }
        completionHandler(ok ? .allow : .cancel)
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        for payload in parser.feed(text) {
            guard let json = payload.data(using: .utf8),
                  let event = try? decoder.decode(LiveRunEvent.self, from: json) else { continue }
            dispatchMain { self.onEvent?(event) }
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        dispatchMain { self.onDisconnected?() }
    }

    private func dispatchMain(_ block: @escaping () -> Void) {
        if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
    }
}
