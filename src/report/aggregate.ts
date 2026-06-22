import type { PricingTable, RunEvent } from '../domain/types.js';
import { priceRun } from '../pricing/cost.js';

/** Rolled-up totals for one grouping key (a repo, a model, etc.). */
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

/** The result of a scan: overall totals plus per-repo and per-model breakdowns. */
export interface ScanSummary {
  readonly totalRuns: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly unpricedModels: readonly string[];
  readonly estimatedModels: readonly string[];
  readonly byRepo: readonly GroupTotals[];
  readonly byModel: readonly GroupTotals[];
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

function byCostThenTokens(a: GroupTotals, b: GroupTotals): number {
  return b.costUsd - a.costUsd || b.totalTokens - a.totalTokens;
}

/** Price every run and roll the events up by repo and by model. */
export function summarize(events: readonly RunEvent[], table: PricingTable): ScanSummary {
  const byRepo = new Map<string, MutableTotals>();
  const byModel = new Map<string, MutableTotals>();
  const unpriced = new Set<string>();
  const estimated = new Set<string>();
  let totalCostUsd = 0;
  let totalTokens = 0;

  for (const event of events) {
    const cost = priceRun(event.model, event.usage, table);
    if (!cost.priced) unpriced.add(event.model);
    if (cost.estimated) estimated.add(event.model);

    const { usage } = event;
    const cacheTokens =
      usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
    const tokens = usage.inputTokens + usage.outputTokens + cacheTokens;
    totalCostUsd += cost.totalUsd;
    totalTokens += tokens;

    for (const [map, key] of [
      [byRepo, event.repo],
      [byModel, event.model],
    ] as const) {
      const totals = map.get(key) ?? emptyTotals(key);
      totals.runs += 1;
      totals.inputTokens += usage.inputTokens;
      totals.outputTokens += usage.outputTokens;
      totals.cacheTokens += cacheTokens;
      totals.totalTokens += tokens;
      totals.costUsd += cost.totalUsd;
      if (!cost.priced) totals.hasUnpriced = true;
      if (cost.estimated) totals.hasEstimated = true;
      map.set(key, totals);
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
  };
}
