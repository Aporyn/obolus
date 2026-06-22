import type { CostBreakdown, PricingTable, RunEvent, TokenUsage } from '../domain/types.js';
import { priceRun } from '../pricing/cost.js';

/** Rolled-up totals for one grouping key (a repo, a model, a branch, ...). */
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

/** The result of a scan: overall totals plus per-dimension breakdowns. */
export interface ScanSummary {
  readonly totalRuns: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly unpricedModels: readonly string[];
  readonly estimatedModels: readonly string[];
  readonly byRepo: readonly GroupTotals[];
  readonly byModel: readonly GroupTotals[];
  readonly byBranch: readonly GroupTotals[];
  /** All sessions, ranked by cost (descending). */
  readonly sessions: readonly SessionTotals[];
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

function accumulate(
  totals: MutableTotals,
  usage: TokenUsage,
  cost: CostBreakdown,
  tokens: number,
): void {
  totals.runs += 1;
  totals.inputTokens += usage.inputTokens;
  totals.outputTokens += usage.outputTokens;
  totals.cacheTokens += usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
  totals.totalTokens += tokens;
  totals.costUsd += cost.totalUsd;
  if (!cost.priced) totals.hasUnpriced = true;
  if (cost.estimated) totals.hasEstimated = true;
}

function bump(
  map: Map<string, MutableTotals>,
  key: string,
  usage: TokenUsage,
  cost: CostBreakdown,
  tokens: number,
): void {
  const totals = map.get(key) ?? emptyTotals(key);
  accumulate(totals, usage, cost, tokens);
  map.set(key, totals);
}

function byCostThenTokens(a: GroupTotals, b: GroupTotals): number {
  return b.costUsd - a.costUsd || b.totalTokens - a.totalTokens;
}

const NO_BRANCH = '(detached/none)';

/** Price every run and roll the events up by repo, model, branch, and session. */
export function summarize(events: readonly RunEvent[], table: PricingTable): ScanSummary {
  const byRepo = new Map<string, MutableTotals>();
  const byModel = new Map<string, MutableTotals>();
  const byBranch = new Map<string, MutableTotals>();
  const bySession = new Map<string, MutableSession>();
  const unpriced = new Set<string>();
  const estimated = new Set<string>();
  let totalCostUsd = 0;
  let totalTokens = 0;

  for (const event of events) {
    const cost = priceRun(event.model, event.usage, table);
    if (!cost.priced) unpriced.add(event.model);
    if (cost.estimated) estimated.add(event.model);

    const tokens = tokensOf(event.usage);
    totalCostUsd += cost.totalUsd;
    totalTokens += tokens;

    bump(byRepo, event.repo, event.usage, cost, tokens);
    bump(byModel, event.model, event.usage, cost, tokens);
    bump(byBranch, event.branch ?? NO_BRANCH, event.usage, cost, tokens);

    let session = bySession.get(event.sessionId);
    if (!session) {
      session = {
        ...emptyTotals(event.sessionId),
        repo: event.repo,
        branch: event.branch,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
      };
      bySession.set(event.sessionId, session);
    }
    accumulate(session, event.usage, cost, tokens);
    if (event.timestamp) {
      if (!session.firstSeen || event.timestamp < session.firstSeen) session.firstSeen = event.timestamp;
      if (event.timestamp > session.lastSeen) session.lastSeen = event.timestamp;
    }
  }

  return {
    totalRuns: events.length,
    totalTokens,
    totalCostUsd,
    unpricedModels: [...unpriced].sort(),
    estimatedModels: [...estimated].sort(),
    byRepo: [...byRepo.values()].sort(byCostThenTokens),
    byModel: [...byModel.values()].sort(byCostThenTokens),
    byBranch: [...byBranch.values()].sort(byCostThenTokens),
    sessions: [...bySession.values()].sort(byCostThenTokens),
  };
}
