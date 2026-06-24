import type {
  CostBreakdown,
  PricingTable,
  RateLimitSnapshot,
  RunEvent,
  TokenUsage,
  Vendor,
} from '../domain/types.js';
import { priceRun } from '../pricing/cost.js';
import { asResolver, type PricingResolver } from '../pricing/registry.js';
import type { Attribution } from './commit-resolution.js';

/** Rolled-up totals for one grouping key (a repo, model, branch, day, ...). */
export interface GroupTotals {
  readonly key: string;
  readonly runs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly hasUnpriced: boolean;
  readonly hasEstimated: boolean;
}

/** A session roll-up, enriched with the repo/branch it ran in and its time span. */
export interface SessionTotals extends GroupTotals {
  readonly repo: string;
  readonly branch: string | null;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

/** A single high-cost run, surfaced to expose outliers. */
export interface RunRef {
  readonly repo: string;
  readonly branch: string | null;
  readonly model: string;
  readonly sessionId: string;
  readonly timestamp: string;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly isSidechain: boolean;
}

/** Where the money went, split by cost component. */
export interface CostComposition {
  readonly inputUsd: number;
  readonly outputUsd: number;
  readonly cacheReadUsd: number;
  readonly cacheWriteUsd: number;
  /** Separately-billed server tools (web search). */
  readonly serverToolUsd: number;
}

/**
 * Per-commit totals. `exactUsd`/`estimatedUsd` split the cost by attribution
 * provenance (live-stamped vs git-reconstructed); they sum to `costUsd` minus
 * any cost in the unattributed bucket.
 */
export interface CommitTotals extends GroupTotals {
  /** Commit subject (first line), or '' for the unattributed bucket. */
  readonly subject: string;
  /** ISO commit date, or '' when unknown. */
  readonly committedAt: string;
  /** Release (tag) the commit belongs to, or null when unreleased. */
  readonly release: string | null;
  readonly exactUsd: number;
  readonly estimatedUsd: number;
}

/** Per-release totals (a git tag, `unreleased`, or `(unattributed)`). */
export interface ReleaseTotals extends GroupTotals {
  readonly firstCommitAt: string;
  readonly lastCommitAt: string;
  readonly commitCount: number;
  readonly exactUsd: number;
  readonly estimatedUsd: number;
}

/**
 * One vendor's slice of a multi-vendor scan: its own full breakdown plus its
 * latest account-level rate-limit snapshot (Codex reports this; null otherwise).
 * The nested `summary.vendors` is always `[]` — the breakdown is one level deep.
 */
export interface VendorBreakdown {
  readonly vendor: string;
  readonly rateLimit: RateLimitSnapshot | null;
  readonly summary: ScanSummary;
}

/** The result of a scan: overall totals plus per-dimension breakdowns. */
export interface ScanSummary {
  readonly totalRuns: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly composition: CostComposition;
  readonly unpricedModels: readonly string[];
  readonly estimatedModels: readonly string[];
  readonly byRepo: readonly GroupTotals[];
  readonly byModel: readonly GroupTotals[];
  readonly byBranch: readonly GroupTotals[];
  readonly byDay: readonly GroupTotals[];
  readonly byWeek: readonly GroupTotals[];
  /** main vs subagent (sidechain). */
  readonly byKind: readonly GroupTotals[];
  /** All sessions, ranked by cost (descending). */
  readonly sessions: readonly SessionTotals[];
  /** Most expensive individual runs (descending), capped. */
  readonly topRuns: readonly RunRef[];
  /** Spend per commit (newest first; unattributed bucket last). Empty unless attribution was resolved. */
  readonly byCommit: readonly CommitTotals[];
  /** Spend per release (tag / unreleased / unattributed). Empty unless attribution was resolved. */
  readonly byRelease: readonly ReleaseTotals[];
  /**
   * Per-vendor breakdown for the multi-vendor dashboard tabs. Populated only on
   * the top-level summary (via `summarizeByVendor`); always `[]` on a nested
   * per-vendor summary, so the structure is exactly one level deep.
   */
  readonly vendors: readonly VendorBreakdown[];
}

interface PricedRun {
  readonly event: RunEvent;
  readonly cost: CostBreakdown;
  readonly tokens: number;
}

interface MutableTotals {
  key: string;
  runs: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  costUsd: number;
  hasUnpriced: boolean;
  hasEstimated: boolean;
}

interface MutableSession extends MutableTotals {
  repo: string;
  branch: string | null;
  firstSeen: string;
  lastSeen: string;
}

const NO_BRANCH = '(detached/none)';
const TOP_RUNS_KEEP = 100;

function tokensOf(u: TokenUsage): number {
  return (
    u.inputTokens +
    u.outputTokens +
    u.cacheReadTokens +
    u.cacheWrite5mTokens +
    u.cacheWrite1hTokens
  );
}

function emptyTotals(key: string): MutableTotals {
  return {
    key,
    runs: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    hasUnpriced: false,
    hasEstimated: false,
  };
}

function accumulate(totals: MutableTotals, run: PricedRun): void {
  const { usage } = run.event;
  totals.runs += 1;
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  totals.cacheTokens += usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
  totals.totalTokens += run.tokens;
  totals.costUsd += run.cost.totalUsd;
  if (!run.cost.priced) totals.hasUnpriced = true;
  if (run.cost.estimated) totals.hasEstimated = true;
}

function foldBy(runs: readonly PricedRun[], keyOf: (run: PricedRun) => string): MutableTotals[] {
  const map = new Map<string, MutableTotals>();
  for (const run of runs) {
    const key = keyOf(run);
    const totals = map.get(key) ?? emptyTotals(key);
    accumulate(totals, run);
    map.set(key, totals);
  }
  return [...map.values()];
}

function foldSessions(runs: readonly PricedRun[]): MutableSession[] {
  const map = new Map<string, MutableSession>();
  for (const run of runs) {
    const ev = run.event;
    let session = map.get(ev.sessionId);
    if (!session) {
      session = {
        ...emptyTotals(ev.sessionId),
        repo: ev.repo,
        branch: ev.branch,
        firstSeen: ev.timestamp,
        lastSeen: ev.timestamp,
      };
      map.set(ev.sessionId, session);
    }
    accumulate(session, run);
    if (ev.timestamp) {
      if (!session.firstSeen || ev.timestamp < session.firstSeen) session.firstSeen = ev.timestamp;
      if (ev.timestamp > session.lastSeen) session.lastSeen = ev.timestamp;
    }
  }
  return [...map.values()];
}

const UNATTRIBUTED = '(unattributed)';
const UNRELEASED = 'unreleased';

interface MutableCommit extends MutableTotals {
  subject: string;
  committedAt: string;
  release: string | null;
  exactUsd: number;
  estimatedUsd: number;
}

interface MutableRelease extends MutableTotals {
  firstCommitAt: string;
  lastCommitAt: string;
  commits: Set<string>;
  exactUsd: number;
  estimatedUsd: number;
}

function addProvenance(
  target: { exactUsd: number; estimatedUsd: number },
  a: Attribution | undefined,
  usd: number,
): void {
  if (a?.confidence === 'exact') target.exactUsd += usd;
  else if (a?.confidence === 'estimated') target.estimatedUsd += usd;
}

function byCommitOrder(a: CommitTotals, b: CommitTotals): number {
  const au = a.key === UNATTRIBUTED;
  const bu = b.key === UNATTRIBUTED;
  if (au !== bu) return au ? 1 : -1;
  if (a.committedAt !== b.committedAt) return a.committedAt < b.committedAt ? 1 : -1; // newest first
  return b.costUsd - a.costUsd;
}

function foldCommits(runs: readonly PricedRun[], attribution: Map<string, Attribution>): CommitTotals[] {
  const map = new Map<string, MutableCommit>();
  for (const run of runs) {
    const a = attribution.get(run.event.id);
    const key = a?.commit ?? UNATTRIBUTED;
    let m = map.get(key);
    if (!m) {
      m = {
        ...emptyTotals(key),
        subject: a?.subject ?? '',
        committedAt: a?.committedAt ?? '',
        release: a?.release ?? null,
        exactUsd: 0,
        estimatedUsd: 0,
      };
      map.set(key, m);
    }
    accumulate(m, run);
    addProvenance(m, a, run.cost.totalUsd);
    if (!m.subject && a?.subject) m.subject = a.subject;
    if (!m.committedAt && a?.committedAt) m.committedAt = a.committedAt;
    if (!m.release && a?.release) m.release = a.release;
  }
  return [...map.values()]
    .map((m): CommitTotals => ({
      key: m.key,
      runs: m.runs,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheTokens: m.cacheTokens,
      totalTokens: m.totalTokens,
      costUsd: m.costUsd,
      hasUnpriced: m.hasUnpriced,
      hasEstimated: m.hasEstimated,
      subject: m.subject,
      committedAt: m.committedAt,
      release: m.release,
      exactUsd: m.exactUsd,
      estimatedUsd: m.estimatedUsd,
    }))
    .sort(byCommitOrder);
}

function releaseKeyOf(a: Attribution | undefined): string {
  if (!a || a.confidence === 'unattributed' || a.commit == null) return UNATTRIBUTED;
  return a.release ?? UNRELEASED;
}

function byReleaseOrder(a: ReleaseTotals, b: ReleaseTotals): number {
  // unreleased first (current work), unattributed last, real releases newest-first.
  const rank = (k: string): number => (k === UNRELEASED ? 0 : k === UNATTRIBUTED ? 2 : 1);
  const ra = rank(a.key);
  const rb = rank(b.key);
  if (ra !== rb) return ra - rb;
  if (a.lastCommitAt !== b.lastCommitAt) return a.lastCommitAt < b.lastCommitAt ? 1 : -1;
  return b.costUsd - a.costUsd;
}

function foldReleases(runs: readonly PricedRun[], attribution: Map<string, Attribution>): ReleaseTotals[] {
  const map = new Map<string, MutableRelease>();
  for (const run of runs) {
    const a = attribution.get(run.event.id);
    const key = releaseKeyOf(a);
    let m = map.get(key);
    if (!m) {
      m = {
        ...emptyTotals(key),
        firstCommitAt: '',
        lastCommitAt: '',
        commits: new Set<string>(),
        exactUsd: 0,
        estimatedUsd: 0,
      };
      map.set(key, m);
    }
    accumulate(m, run);
    addProvenance(m, a, run.cost.totalUsd);
    if (a?.commit) m.commits.add(a.commit);
    if (a?.committedAt) {
      if (!m.firstCommitAt || a.committedAt < m.firstCommitAt) m.firstCommitAt = a.committedAt;
      if (a.committedAt > m.lastCommitAt) m.lastCommitAt = a.committedAt;
    }
  }
  return [...map.values()]
    .map((m): ReleaseTotals => ({
      key: m.key,
      runs: m.runs,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheTokens: m.cacheTokens,
      totalTokens: m.totalTokens,
      costUsd: m.costUsd,
      hasUnpriced: m.hasUnpriced,
      hasEstimated: m.hasEstimated,
      firstCommitAt: m.firstCommitAt,
      lastCommitAt: m.lastCommitAt,
      commitCount: m.commits.size,
      exactUsd: m.exactUsd,
      estimatedUsd: m.estimatedUsd,
    }))
    .sort(byReleaseOrder);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` of a Date in the *local* timezone (the machine running the collector). */
function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Day buckets use the local timezone, not UTC — this is a per-developer local tool, so "today"
 * should follow the user's own clock (their dashboard/app/CLI all read the same local key).
 */
function dayKey(iso: string): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return localDayKey(date);
}

/** Local-date `YYYY-MM-DD` of the Monday that starts the run's week. */
function weekKey(iso: string): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const mondayOffset = (date.getDay() + 6) % 7;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset);
  return localDayKey(monday);
}

function byCostThenTokens(a: GroupTotals, b: GroupTotals): number {
  return b.costUsd - a.costUsd || b.totalTokens - a.totalTokens;
}

function byKeyAscending(a: GroupTotals, b: GroupTotals): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Options for `summarize`. */
export interface SummarizeOptions {
  /**
   * Per-run commit/release attribution (see commit-resolution). When provided,
   * `byCommit`/`byRelease` are populated; otherwise they are empty.
   */
  readonly attribution?: Map<string, Attribution>;
}

/**
 * Price every run once, then roll the events up across every dimension. Accepts
 * either a single pricing table (priced uniformly) or a per-vendor resolver, so
 * a mixed claude-code + codex stream is priced with each vendor's own table.
 */
export function summarize(
  events: readonly RunEvent[],
  pricing: PricingTable | PricingResolver,
  opts: SummarizeOptions = {},
): ScanSummary {
  const resolve = asResolver(pricing);
  const priced: PricedRun[] = events.map((event) => ({
    event,
    cost: priceRun(event.model, event.usage, resolve(event.vendor), event.serverTools),
    tokens: tokensOf(event.usage),
  }));

  const unpriced = new Set<string>();
  const estimated = new Set<string>();
  let totalCostUsd = 0;
  let totalTokens = 0;
  const composition = {
    inputUsd: 0,
    outputUsd: 0,
    cacheReadUsd: 0,
    cacheWriteUsd: 0,
    serverToolUsd: 0,
  };

  for (const run of priced) {
    if (!run.cost.priced) unpriced.add(run.event.model);
    if (run.cost.estimated) estimated.add(run.event.model);
    totalCostUsd += run.cost.totalUsd;
    totalTokens += run.tokens;
    composition.inputUsd += run.cost.inputUsd;
    composition.outputUsd += run.cost.outputUsd;
    composition.cacheReadUsd += run.cost.cacheReadUsd;
    composition.cacheWriteUsd += run.cost.cacheWriteUsd;
    composition.serverToolUsd += run.cost.serverToolUsd;
  }

  const topRuns: RunRef[] = [...priced]
    .sort((a, b) => b.cost.totalUsd - a.cost.totalUsd)
    .slice(0, TOP_RUNS_KEEP)
    .map((run) => ({
      repo: run.event.repo,
      branch: run.event.branch,
      model: run.event.model,
      sessionId: run.event.sessionId,
      timestamp: run.event.timestamp,
      costUsd: run.cost.totalUsd,
      totalTokens: run.tokens,
      isSidechain: run.event.isSidechain,
    }));

  return {
    totalRuns: events.length,
    totalTokens,
    totalCostUsd,
    composition,
    unpricedModels: [...unpriced].sort(),
    estimatedModels: [...estimated].sort(),
    byRepo: foldBy(priced, (r) => r.event.repo).sort(byCostThenTokens),
    byModel: foldBy(priced, (r) => r.event.model).sort(byCostThenTokens),
    byBranch: foldBy(priced, (r) => r.event.branch ?? NO_BRANCH).sort(byCostThenTokens),
    byDay: foldBy(priced, (r) => dayKey(r.event.timestamp)).sort(byKeyAscending),
    byWeek: foldBy(priced, (r) => weekKey(r.event.timestamp)).sort(byKeyAscending),
    byKind: foldBy(priced, (r) => (r.event.isSidechain ? 'subagent' : 'main')).sort(byCostThenTokens),
    sessions: foldSessions(priced).sort(byCostThenTokens),
    topRuns,
    byCommit: opts.attribution ? foldCommits(priced, opts.attribution) : [],
    byRelease: opts.attribution ? foldReleases(priced, opts.attribution) : [],
    // Always present; populated only at the top level by `summarizeByVendor`.
    vendors: [],
  };
}

/** Options for `summarizeByVendor`. */
export interface SummarizeByVendorOptions extends SummarizeOptions {
  /** Latest account-level rate-limit snapshot per vendor (Codex reports these). */
  readonly rateLimits?: readonly RateLimitSnapshot[];
}

/**
 * Summarize a multi-vendor event stream into a combined top-level summary whose
 * `vendors` field carries each vendor's own full breakdown + rate-limit snapshot.
 * The combined fields (totals, byRepo, …) span all vendors; each `vendors[]`
 * entry is the same shape scoped to one vendor.
 */
export function summarizeByVendor(
  events: readonly RunEvent[],
  pricing: PricingTable | PricingResolver,
  opts: SummarizeByVendorOptions = {},
): ScanSummary {
  const combined = summarize(events, pricing, opts);

  const byVendor = new Map<Vendor, RunEvent[]>();
  for (const event of events) {
    const bucket = byVendor.get(event.vendor);
    if (bucket) bucket.push(event);
    else byVendor.set(event.vendor, [event]);
  }

  const rateLimitOf = new Map<string, RateLimitSnapshot>();
  for (const snap of opts.rateLimits ?? []) rateLimitOf.set(snap.vendor, snap);

  const vendors: VendorBreakdown[] = [...byVendor.entries()]
    .map(([vendor, vendorEvents]): VendorBreakdown => ({
      vendor,
      rateLimit: rateLimitOf.get(vendor) ?? null,
      summary: summarize(vendorEvents, pricing, opts),
    }))
    .sort((a, b) => b.summary.totalCostUsd - a.summary.totalCostUsd);

  return { ...combined, vendors };
}
