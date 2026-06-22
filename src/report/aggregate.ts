import type { CostBreakdown, PricingTable, RunEvent, TokenUsage } from '../domain/types.js';
import { priceRun } from '../pricing/cost.js';

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

/** Where the money went, split by token class. */
export interface CostComposition {
  readonly inputUsd: number;
  readonly outputUsd: number;
  readonly cacheReadUsd: number;
  readonly cacheWriteUsd: number;
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

function dayKey(iso: string): string {
  return iso ? iso.slice(0, 10) : 'unknown';
}

/** ISO date (YYYY-MM-DD) of the Monday that starts the run's week, in UTC. */
function weekKey(iso: string): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset),
  );
  return monday.toISOString().slice(0, 10);
}

function byCostThenTokens(a: GroupTotals, b: GroupTotals): number {
  return b.costUsd - a.costUsd || b.totalTokens - a.totalTokens;
}

function byKeyAscending(a: GroupTotals, b: GroupTotals): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Price every run once, then roll the events up across every dimension. */
export function summarize(events: readonly RunEvent[], table: PricingTable): ScanSummary {
  const priced: PricedRun[] = events.map((event) => ({
    event,
    cost: priceRun(event.model, event.usage, table),
    tokens: tokensOf(event.usage),
  }));

  const unpriced = new Set<string>();
  const estimated = new Set<string>();
  let totalCostUsd = 0;
  let totalTokens = 0;
  const composition = { inputUsd: 0, outputUsd: 0, cacheReadUsd: 0, cacheWriteUsd: 0 };

  for (const run of priced) {
    if (!run.cost.priced) unpriced.add(run.event.model);
    if (run.cost.estimated) estimated.add(run.event.model);
    totalCostUsd += run.cost.totalUsd;
    totalTokens += run.tokens;
    composition.inputUsd += run.cost.inputUsd;
    composition.outputUsd += run.cost.outputUsd;
    composition.cacheReadUsd += run.cost.cacheReadUsd;
    composition.cacheWriteUsd += run.cost.cacheWriteUsd;
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
  };
}
