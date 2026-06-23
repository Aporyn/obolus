import Foundation
import Combine

/// Lifecycle state of the managed `obolus serve` child process.
public enum ServeState: Equatable {
    case starting
    case running(URL)
    case failed(String)
    case stopped
}

/// Spawns `obolus serve --port 0` as a headless data backend, discovers the bound URL from its
/// `OBOLUS_SERVE_READY_JSON` line, and exposes it to the app. Terminates the child on `stop()`.
///
/// Runtime resolution order (first that exists wins):
///   1. `OBOLUS_NODE` + `OBOLUS_DIST` env (dev override — point at the workspace build).
///   2. Bundled `node` + `obolus/dist/index.js` under the app's Resources (release).
///   3. A `node` found at a common absolute path + bundled/env dist.
///   4. `npx obolus` fallback (requires npx on a common path).
public final class ServeProcess: ObservableObject {
    @Published public private(set) var state: ServeState = .stopped
    @Published public private(set) var baseURL: URL?

    private var process: Process?
    private var stdoutBuffer = ""
    private let readyMarker = "\"obolusServe\""

    public init() {}

    deinit { process?.terminate() }

    public func start() {
        guard process == nil else { return }
        setState(.starting)
        guard let command = Self.resolveCommand() else {
            setState(.failed("Could not locate a Node runtime or the obolus CLI. Set OBOLUS_NODE and OBOLUS_DIST, or install obolus."))
            return
        }

        let proc = Process()
        proc.executableURL = command.executable
        proc.arguments = command.arguments
        var env = ProcessInfo.processInfo.environment
        env["OBOLUS_SERVE_READY_JSON"] = "1"
        proc.environment = env

        let stdout = Pipe()
        let stderr = Pipe()
        proc.standardOutput = stdout
        proc.standardError = stderr

        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            self?.ingestStdout(text)
        }

        proc.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.process = nil
                self.baseURL = nil
                if case .failed = self.state {} else { self.state = .stopped }
            }
        }

        do {
            try proc.run()
            process = proc
        } catch {
            setState(.failed("Failed to launch obolus serve: \(error.localizedDescription)"))
        }
    }

    public func stop() {
        process?.terminate()
        process = nil
        setState(.stopped)
    }

    public func restart() {
        stop()
        start()
    }

    // MARK: - stdout parsing

    private func ingestStdout(_ text: String) {
        stdoutBuffer += text
        while let newline = stdoutBuffer.firstIndex(of: "\n") {
            let line = String(stdoutBuffer[..<newline])
            stdoutBuffer.removeSubrange(stdoutBuffer.startIndex...newline)
            handleLine(line.trimmingCharacters(in: .whitespaces))
        }
    }

    private func handleLine(_ line: String) {
        guard line.contains(readyMarker), let data = line.data(using: .utf8) else { return }
        struct Ready: Decodable { let url: String }
        guard let ready = try? JSONDecoder().decode(Ready.self, from: data),
              let url = URL(string: ready.url) else { return }
        DispatchQueue.main.async {
            self.baseURL = url
            self.state = .running(url)
        }
    }

    private func setState(_ newState: ServeState) {
        if Thread.isMainThread { state = newState }
        else { DispatchQueue.main.async { self.state = newState } }
    }

    // MARK: - runtime resolution

    public struct Command { public let executable: URL; public let arguments: [String] }

    static func resolveCommand(env: [String: String] = ProcessInfo.processInfo.environment,
                               bundle: Bundle = .main,
                               fileExists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }) -> Command? {
        let serveArgs = ["serve", "--port", "0"]

        // 1. Dev override.
        if let node = env["OBOLUS_NODE"], let dist = env["OBOLUS_DIST"], fileExists(node) {
            let entry = dist.hasSuffix(".js") ? dist : (dist as NSString).appendingPathComponent("index.js")
            if fileExists(entry) {
                return Command(executable: URL(fileURLWithPath: node), arguments: [entry] + serveArgs)
            }
        }

        // 2/3. A node binary + an obolus entry (bundled dist preferred, else env dist).
        let nodeCandidates = [
            env["OBOLUS_NODE"],
            bundle.resourceURL?.appendingPathComponent("node").path,
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ].compactMap { $0 }

        let entryCandidates = [
            bundle.resourceURL?.appendingPathComponent("obolus/dist/index.js").path,
            env["OBOLUS_DIST"].map { $0.hasSuffix(".js") ? $0 : ($0 as NSString).appendingPathComponent("index.js") },
        ].compactMap { $0 }

        if let node = nodeCandidates.first(where: fileExists),
           let entry = entryCandidates.first(where: fileExists) {
            return Command(executable: URL(fileURLWithPath: node), arguments: [entry] + serveArgs)
        }

        // 4. npx obolus fallback.
        let npxCandidates = ["/opt/homebrew/bin/npx", "/usr/local/bin/npx", "/usr/bin/npx"]
        if let npx = npxCandidates.first(where: fileExists) {
            return Command(executable: URL(fileURLWithPath: npx), arguments: ["obolus"] + serveArgs)
        }

        return nil
    }
}
