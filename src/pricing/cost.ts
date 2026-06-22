import type { CostBreakdown, ModelRates, PricingTable, TokenUsage } from '../domain/types.js';

const PER_TOKENS = 1_000_000;

/** No rate found for the model — cost is unknown, surfaced as unpriced upstream. */
const UNPRICED: CostBreakdown = {
  inputUsd: 0,
  outputUsd: 0,
  cacheReadUsd: 0,
  cacheWriteUsd: 0,
  totalUsd: 0,
  priced: false,
  estimated: false,
};

/** Compute cost for a usage record given explicit per-model rates (USD per 1M tokens). */
export function costForUsage(usage: TokenUsage, rates: ModelRates): CostBreakdown {
  const inputUsd = (usage.inputTokens * rates.input) / PER_TOKENS;
  const outputUsd = (usage.outputTokens * rates.output) / PER_TOKENS;
  const cacheReadUsd = (usage.cacheReadTokens * rates.cacheRead) / PER_TOKENS;
  const cacheWriteUsd =
    (usage.cacheWrite5mTokens * rates.cacheWrite5m +
      usage.cacheWrite1hTokens * rates.cacheWrite1h) /
    PER_TOKENS;
  return {
    inputUsd,
    outputUsd,
    cacheReadUsd,
    cacheWriteUsd,
    totalUsd: inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd,
    priced: true,
    estimated: !rates.verified,
  };
}

/** Resolve rates for a model id, tolerating a provider date suffix (e.g. `-20260115`). */
function lookupRates(model: string, table: PricingTable): ModelRates | undefined {
  const direct = table.models[model];
  if (direct) return direct;
  const base = model.replace(/-\d{8}$/, '');
  return table.models[base];
}

/** Price a run by model id. Unknown model → unpriced (zero cost), surfaced upstream. */
export function priceRun(model: string, usage: TokenUsage, table: PricingTable): CostBreakdown {
  const rates = lookupRates(model, table);
  if (!rates) return UNPRICED;
  return costForUsage(usage, rates);
}
