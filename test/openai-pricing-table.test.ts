import { describe, it, expect } from 'vitest';
import { OPENAI_PRICING } from '../src/pricing/openai-pricing-table.js';
import { priceRun } from '../src/pricing/cost.js';
import type { TokenUsage } from '../src/domain/types.js';

const NO_CACHE_WRITE = { cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

describe('OPENAI_PRICING', () => {
  it('has the PricingTable shape (asOf, source, USD currency, serverTools)', () => {
    expect(typeof OPENAI_PRICING.asOf).toBe('string');
    expect(typeof OPENAI_PRICING.source).toBe('string');
    expect(OPENAI_PRICING.currency).toBe('USD');
    expect(OPENAI_PRICING.serverTools).toBeDefined();
    expect(Object.keys(OPENAI_PRICING.models).length).toBeGreaterThan(0);
  });

  it('every model rate is non-negative and has zero cache-write tiers (OpenAI has none)', () => {
    for (const rates of Object.values(OPENAI_PRICING.models)) {
      expect(rates.input).toBeGreaterThanOrEqual(0);
      expect(rates.output).toBeGreaterThanOrEqual(0);
      expect(rates.cacheRead).toBeGreaterThanOrEqual(0);
      expect(rates.cacheWrite5m).toBe(0);
      expect(rates.cacheWrite1h).toBe(0);
    }
  });

  it('prices a known gpt-5.5 codex run with the OpenAI table', () => {
    const usage: TokenUsage = {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      ...NO_CACHE_WRITE,
    };
    const cost = priceRun('gpt-5.5', usage, OPENAI_PRICING);
    expect(cost.priced).toBe(true);
    // 1.25 (input) + 10 (output) + 0.125 (cache read) = 11.375
    expect(cost.totalUsd).toBeCloseTo(11.375, 6);
  });

  it('returns unpriced for an unknown openai model id', () => {
    const usage: TokenUsage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, ...NO_CACHE_WRITE };
    const cost = priceRun('gpt-9-imaginary', usage, OPENAI_PRICING);
    expect(cost.priced).toBe(false);
    expect(cost.totalUsd).toBe(0);
  });

  it('marks a priced run estimated because rates are unverified (best-effort)', () => {
    const usage: TokenUsage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, ...NO_CACHE_WRITE };
    const cost = priceRun('gpt-5-codex', usage, OPENAI_PRICING);
    expect(cost.priced).toBe(true);
    expect(cost.estimated).toBe(true);
  });
});
