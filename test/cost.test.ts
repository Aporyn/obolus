import { describe, it, expect } from 'vitest';
import { costForUsage, priceRun } from '../src/pricing/cost.js';
import type { ModelRates, PricingTable, TokenUsage } from '../src/domain/types.js';

const rates: ModelRates = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite5m: 3.75,
  cacheWrite1h: 6,
  verified: true,
};

const oneMillionEach: TokenUsage = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  cacheWrite5mTokens: 1_000_000,
  cacheWrite1hTokens: 1_000_000,
};

describe('costForUsage', () => {
  it('multiplies each token class by its per-MTok rate', () => {
    const c = costForUsage(oneMillionEach, rates);
    expect(c.inputUsd).toBeCloseTo(3);
    expect(c.outputUsd).toBeCloseTo(15);
    expect(c.cacheReadUsd).toBeCloseTo(0.3);
    expect(c.cacheWriteUsd).toBeCloseTo(3.75 + 6);
    expect(c.totalUsd).toBeCloseTo(3 + 15 + 0.3 + 3.75 + 6);
    expect(c.priced).toBe(true);
    expect(c.estimated).toBe(false);
  });

  it('flags estimated when rates are unverified', () => {
    const c = costForUsage(oneMillionEach, { ...rates, verified: false });
    expect(c.estimated).toBe(true);
  });
});

describe('priceRun', () => {
  const table: PricingTable = {
    asOf: '2026-01-01',
    source: 'test',
    currency: 'USD',
    models: { 'model-a': rates },
  };

  it('returns unpriced for unknown models', () => {
    const c = priceRun('unknown', oneMillionEach, table);
    expect(c.priced).toBe(false);
    expect(c.totalUsd).toBe(0);
  });

  it('prices a known model', () => {
    const c = priceRun('model-a', oneMillionEach, table);
    expect(c.priced).toBe(true);
    expect(c.totalUsd).toBeGreaterThan(0);
  });
});
