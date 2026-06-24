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
    serverTools: { webSearchPerRequest: 0.01, webFetchPerRequest: 0, verified: true },
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

  it('adds web-search requests on top of token cost (billed per request)', () => {
    const noTools = priceRun('model-a', oneMillionEach, table);
    const withSearch = priceRun('model-a', oneMillionEach, table, {
      webSearchRequests: 5,
      webFetchRequests: 0,
    });
    // $10 / 1,000 searches = $0.01 each → 5 searches = $0.05 above the token cost.
    expect(withSearch.serverToolUsd).toBeCloseTo(0.05);
    expect(withSearch.totalUsd).toBeCloseTo(noTools.totalUsd + 0.05);
  });

  it('charges nothing extra for web-fetch requests (token-only today)', () => {
    const c = priceRun('model-a', oneMillionEach, table, {
      webSearchRequests: 0,
      webFetchRequests: 9,
    });
    expect(c.serverToolUsd).toBe(0);
  });

  it('defaults to zero server-tool cost when no server tools are passed', () => {
    const c = priceRun('model-a', oneMillionEach, table);
    expect(c.serverToolUsd).toBe(0);
  });

  it('does not price server tools for an unknown (unpriced) model', () => {
    const c = priceRun('unknown', oneMillionEach, table, {
      webSearchRequests: 5,
      webFetchRequests: 0,
    });
    expect(c.priced).toBe(false);
    expect(c.serverToolUsd).toBe(0);
    expect(c.totalUsd).toBe(0);
  });

  it('flags estimated when a server tool was used at an unverified rate', () => {
    const unverified: PricingTable = {
      ...table,
      serverTools: { webSearchPerRequest: 0.01, webFetchPerRequest: 0, verified: false },
    };
    const used = priceRun('model-a', oneMillionEach, unverified, {
      webSearchRequests: 1,
      webFetchRequests: 0,
    });
    expect(used.estimated).toBe(true);
    // A run that used no server tools is unaffected by the unverified server-tool rate.
    const unused = priceRun('model-a', oneMillionEach, unverified);
    expect(unused.estimated).toBe(false);
  });
});
