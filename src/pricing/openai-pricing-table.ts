import type { ModelRates, PricingTable, ServerToolRates } from '../domain/types.js';

// OpenAI published rates, USD per 1,000,000 tokens — for Codex CLI spend.
// Cost is NOT stored in Codex rollout files; Obolus computes it from token
// counts x these rates, so every figure is an estimate (see v1-scope.md s3).
//
// IMPORTANT (invariant #4 — estimates): these rates are marked `verified: false`
// until confirmed against the live OpenAI price list, so every Codex run surfaces
// in `estimatedModels` and the UI can label it best-effort. Re-verify and flip to
// `true` (bumping `asOf`) once confirmed.
//
// Model mapping notes:
//   - OpenAI has NO cache-write tiers (no 5m/1h ephemeral cache like Anthropic),
//     so `cacheWrite5m`/`cacheWrite1h` are 0 — the Codex reader always emits
//     0 cache-write tokens, so these rates are never exercised, but 0 is honest.
//   - `cacheRead` is the cached-input rate (a discount on input).
//   - Reasoning tokens are billed at the output rate and are already counted
//     inside `output_tokens` (the reader does not add them separately).
//   - Codex web search is not separately metered in the token accounting Obolus
//     reads, so server-tool rates are 0.

/** GPT-5 / gpt-5-codex family: $1.25 in · $0.125 cached · $10 out per 1M (best-effort). */
function gpt5x(): ModelRates {
  return { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite5m: 0, cacheWrite1h: 0, verified: false };
}

/** Lighter review/mini model used for codex auto-review turns (best-effort). */
function gpt5Mini(): ModelRates {
  return { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite5m: 0, cacheWrite1h: 0, verified: false };
}

// Codex turns carry no separately-billed server tools in the rollout token
// accounting Obolus reads — kept at 0 so a count (if ever present) is carried
// for audit without inventing a charge.
function serverTools(): ServerToolRates {
  return { webSearchPerRequest: 0, webFetchPerRequest: 0, verified: false };
}

export const OPENAI_PRICING: PricingTable = {
  asOf: '2026-06-25',
  source: 'https://platform.openai.com/docs/pricing (rates unconfirmed — best-effort)',
  currency: 'USD',
  serverTools: serverTools(),
  models: {
    // GPT-5 / Codex family (ids observed in turn_context.model)
    'gpt-5.5': gpt5x(),
    'gpt-5.5-codex': gpt5x(),
    'gpt-5.3-codex': gpt5x(),
    'gpt-5.1-codex': gpt5x(),
    'gpt-5-codex': gpt5x(),
    'gpt-5': gpt5x(),
    // Lighter auto-review / mini models
    'codex-auto-review': gpt5Mini(),
    'gpt-5-codex-mini': gpt5Mini(),
    'codex-mini-latest': gpt5Mini(),
  },
};
