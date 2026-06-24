import type { PricingTable, Vendor } from '../domain/types.js';
import { ANTHROPIC_PRICING } from './pricing-table.js';
import { OPENAI_PRICING } from './openai-pricing-table.js';

/**
 * Resolve the pricing table to use for a run, given its vendor. Lets a single
 * aggregation price a mixed claude-code + codex event stream, each with its own
 * rate table.
 */
export type PricingResolver = (vendor: Vendor) => PricingTable;

/** Default vendor → pricing table mapping. */
export function defaultPricingFor(vendor: Vendor): PricingTable {
  switch (vendor) {
    case 'codex':
      return OPENAI_PRICING;
    case 'claude-code':
    case 'cursor':
    default:
      return ANTHROPIC_PRICING;
  }
}

/** Normalize a table-or-resolver argument into a resolver. */
export function asResolver(pricing: PricingTable | PricingResolver): PricingResolver {
  return typeof pricing === 'function' ? pricing : () => pricing;
}
