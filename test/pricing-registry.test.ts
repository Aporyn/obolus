import { describe, it, expect } from 'vitest';
import { defaultPricingFor, asResolver } from '../src/pricing/registry.js';
import { ANTHROPIC_PRICING } from '../src/pricing/pricing-table.js';
import { OPENAI_PRICING } from '../src/pricing/openai-pricing-table.js';

describe('defaultPricingFor', () => {
  it('returns the Anthropic table for claude-code', () => {
    expect(defaultPricingFor('claude-code')).toBe(ANTHROPIC_PRICING);
  });

  it('returns the OpenAI table for codex', () => {
    expect(defaultPricingFor('codex')).toBe(OPENAI_PRICING);
  });

  it('falls back to the Anthropic table for other vendors', () => {
    expect(defaultPricingFor('cursor')).toBe(ANTHROPIC_PRICING);
  });
});

describe('asResolver', () => {
  it('wraps a plain table into a constant resolver', () => {
    const resolve = asResolver(ANTHROPIC_PRICING);
    expect(resolve('codex')).toBe(ANTHROPIC_PRICING);
    expect(resolve('claude-code')).toBe(ANTHROPIC_PRICING);
  });

  it('passes a resolver through unchanged', () => {
    const resolve = asResolver(defaultPricingFor);
    expect(resolve('codex')).toBe(OPENAI_PRICING);
    expect(resolve('claude-code')).toBe(ANTHROPIC_PRICING);
  });
});
