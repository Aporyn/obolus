import type { ModelRates, PricingTable, ServerToolRates } from '../domain/types.js';

// Anthropic published rates, USD per 1,000,000 tokens.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-06-23).
//
// Cost is NOT stored in Claude Code transcripts — Obolus computes it from token
// counts x these rates, so every figure is an estimate (see v1-scope.md s3).
// Re-verify whenever Anthropic changes pricing and bump `asOf`.
//
// Known limitations (intentionally not modelled in v0):
//   - Fast mode (Opus 4.6-4.8) and `inference_geo: "us"` (1.1x) change the rate;
//     transcripts expose a usage `speed` field we can wire in later.
//   - Batch API (-50%) is not used by interactive Claude Code.

function opus4x(): ModelRates {
  return { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10, verified: true };
}

function sonnet4x(): ModelRates {
  return { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6, verified: true };
}

function frontier5(): ModelRates {
  return { input: 10, output: 50, cacheRead: 1, cacheWrite5m: 12.5, cacheWrite1h: 20, verified: true };
}

// Server-tool per-request rates (billed on top of token costs).
//   - web search: $10 / 1,000 searches = $0.01 / request.
//   - web fetch:  no additional charge — you pay only for the fetched tokens
//     (already counted as input). Kept at 0 so the count is carried for audit
//     without inventing a charge.
// Source: web-search-tool / web-fetch-tool docs §"Usage and pricing" (fetched 2026-06-24).
function serverTools(): ServerToolRates {
  return { webSearchPerRequest: 0.01, webFetchPerRequest: 0, verified: true };
}

export const ANTHROPIC_PRICING: PricingTable = {
  asOf: '2026-06-23',
  source: 'https://platform.claude.com/docs/en/about-claude/pricing',
  currency: 'USD',
  serverTools: serverTools(),
  models: {
    // Frontier 5 family
    'claude-fable-5': frontier5(),
    'claude-mythos-5': frontier5(),
    // Opus 4.x (flat $5 / $25)
    'claude-opus-4-8': opus4x(),
    'claude-opus-4-7': opus4x(),
    'claude-opus-4-6': opus4x(),
    'claude-opus-4-5': opus4x(),
    // Sonnet 4.x
    'claude-sonnet-4-6': sonnet4x(),
    'claude-sonnet-4-5': sonnet4x(),
    'claude-sonnet-4': sonnet4x(),
    // Haiku 4.5
    'claude-haiku-4-5': {
      input: 1,
      output: 5,
      cacheRead: 0.1,
      cacheWrite5m: 1.25,
      cacheWrite1h: 2,
      verified: true,
    },
    // Legacy reference rates (retired/deprecated families)
    'claude-opus-4-1': {
      input: 15,
      output: 75,
      cacheRead: 1.5,
      cacheWrite5m: 18.75,
      cacheWrite1h: 30,
      verified: true,
    },
    'claude-3-5-sonnet': {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite5m: 3.75,
      cacheWrite1h: 6,
      verified: true,
    },
    'claude-3-5-haiku': {
      input: 0.8,
      output: 4,
      cacheRead: 0.08,
      cacheWrite5m: 1,
      cacheWrite1h: 1.6,
      verified: true,
    },
    'claude-3-opus': {
      input: 15,
      output: 75,
      cacheRead: 1.5,
      cacheWrite5m: 18.75,
      cacheWrite1h: 30,
      verified: true,
    },
  },
};
