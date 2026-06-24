import Foundation
import Combine

/// The app's view-model. Owns the two data planes:
///   • History — `summary`, polled from `GET /api/summary` (full local history, all dimensions).
///   • Live (this session) — `liveFeed` + `runningUsd`/`runningRuns`, streamed from `GET /api/events`,
///     covering only the window since the stream connected (`trackingSince`).
@MainActor
public final class SummaryStore: ObservableObject {
    // History plane.
    @Published public private(set) var summary: ScanSummary = .empty
    @Published public private(set) var lastUpdated: Date?
    @Published public private(set) var loadError: String?
    @Published public private(set) var isLoading = false

    // Live plane.
    @Published public private(set) var liveFeed: [LiveRunEvent] = []
    @Published public private(set) var isLive = false
    @Published public private(set) var trackingSince: Date?
    @Published public private(set) var runningUsd: Double = 0
    @Published public private(set) var runningRuns: Int = 0

    public static let liveFeedMax = 50
    private let refreshInterval: TimeInterval

    private var baseURL: URL?
    private let stream = LiveEventStream()
    private var cancellables = Set<AnyCancellable>()
    private var refreshTimer: Timer?
    private let session: URLSession

    public init(refreshInterval: TimeInterval = 15, session: URLSession = .shared) {
        self.refreshInterval = refreshInterval
        self.session = session
        configureStream()
    }

    /// Bind to a serve process: react to its base URL becoming available / going away.
    public func attach(to serve: ServeProcess) {
        serve.$baseURL
            .receive(on: RunLoop.main)
            .sink { [weak self] url in self?.handleBaseURL(url) }
            .store(in: &cancellables)
    }

    private func handleBaseURL(_ url: URL?) {
        baseURL = url
        guard let url else {
            stopLive()
            return
        }
        stream.start(url: url.appendingPathComponent("api/events"))
        Task { await refresh() }
        startRefreshTimer()
    }

    // MARK: - History

    public func refresh() async {
        guard let base = baseURL else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let (data, response) = try await session.data(from: base.appendingPathComponent("api/summary"))
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                loadError = "Summary request failed."
                return
            }
            summary = try JSONDecoder().decode(ScanSummary.self, from: data)
            lastUpdated = Date()
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// Build the `/api/summary` URL for a timeframe (testable; pure).
    public nonisolated static func summaryURL(base: URL, timeframe: Timeframe) -> URL {
        let endpoint = base.appendingPathComponent("api/summary")
        guard let since = timeframe.sinceParam else { return endpoint }
        var comps = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        comps?.queryItems = [URLQueryItem(name: "since", value: since)]
        return comps?.url ?? endpoint
    }

    /// One-shot windowed history fetch for the dashboard window. Independent of the popup's
    /// all-time `summary`/poll, so changing the dashboard range never starves the popup.
    public func fetchSummary(timeframe: Timeframe) async -> ScanSummary? {
        guard let base = baseURL else { return nil }
        do {
            let (data, response) = try await session.data(from: Self.summaryURL(base: base, timeframe: timeframe))
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return try JSONDecoder().decode(ScanSummary.self, from: data)
        } catch {
            return nil
        }
    }

    private func startRefreshTimer() {
        refreshTimer?.invalidate()
        let timer = Timer(timeInterval: refreshInterval, repeats: true) { [weak self] _ in
            Task { await self?.refresh() }
        }
        RunLoop.main.add(timer, forMode: .common)
        refreshTimer = timer
    }

    // MARK: - Live

    private func configureStream() {
        stream.onConnected = { [weak self] in
            guard let self else { return }
            self.isLive = true
            if self.trackingSince == nil { self.trackingSince = Date() }
        }
        stream.onDisconnected = { [weak self] in
            self?.isLive = false
        }
        stream.onEvent = { [weak self] event in
            guard let self else { return }
            self.liveFeed.insert(event, at: 0)
            if self.liveFeed.count > Self.liveFeedMax {
                self.liveFeed.removeLast(self.liveFeed.count - Self.liveFeedMax)
            }
            self.runningUsd = event.runningUsd
            self.runningRuns = event.runningRuns
        }
    }

    private func stopLive() {
        stream.stop()
        isLive = false
    }
}
