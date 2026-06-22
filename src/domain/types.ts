// Core domain types for Obolus.
// Derived from the real Claude Code transcript schema. Metadata only — these
// types intentionally carry NO code, prompt, or message content.

/** A vendor whose coding-agent spend Obolus can attribute. Cross-vendor by design. */
export type Vendor = 'claude-code' | 'codex' | 'cursor';

/**
 * Token usage for a single agent run, normalized to vendor-neutral fields.
 * Cache writes are split by TTL because they are priced differently.
 */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWrite5mTokens: number;
  readonly cacheWrite1hTokens: number;
}

/**
 * One attributed agent run (one assistant message, in Claude Code terms).
 * This is the atomic ledger record — metadata only.
 */
export interface RunEvent {
  /** Stable id used for de-duplication (message uuid, falling back to request id). */
  readonly id: string;
  readonly vendor: Vendor;
  readonly model: string;
  readonly usage: TokenUsage;
  /** Full working-directory path the run happened in (the durable repo key). */
  readonly repoPath: string;
  /** Friendly repo label (basename of the working directory). */
  readonly repo: string;
  readonly branch: string | null;
  readonly sessionId: string;
  /** Provider request id — unique per run; secondary de-dup / audit key. */
  readonly requestId: string | null;
  /** ISO 8601 timestamp of the run. */
  readonly timestamp: string;
  /** Source tool version (e.g. Claude Code version), for auditability. */
  readonly toolVersion: string | null;
}

/** Per-model rates, expressed in USD per 1,000,000 tokens. */
export interface ModelRates {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  /** True when the rate has been confirmed against the vendor price list. */
  readonly verified: boolean;
}

/** A dated, sourced price list. Cost is computed, never read from telemetry. */
export interface PricingTable {
  readonly asOf: string;
  readonly source: string;
  readonly currency: 'USD';
  readonly models: Readonly<Record<string, ModelRates>>;
}

/** Computed cost for one usage record. */
export interface CostBreakdown {
  readonly inputUsd: number;
  readonly outputUsd: number;
  readonly cacheReadUsd: number;
  readonly cacheWriteUsd: number;
  readonly totalUsd: number;
  /** A rate was found for the model. */
  readonly priced: boolean;
  /** The rate is a best-effort estimate, not verified against the vendor price list. */
  readonly estimated: boolean;
}
