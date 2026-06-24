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
 * Counts of Anthropic-executed server tools used in a run. These are billed
 * separately from tokens (web search is per-request), so they must be priced in
 * on top of token cost — otherwise runs that searched the web are undercounted.
 * Counts only — never the query text or fetched content (metadata-only invariant).
 */
export interface ServerToolUse {
  /** `usage.server_tool_use.web_search_requests` — Anthropic bills this per request. */
  readonly webSearchRequests: number;
  /** `usage.server_tool_use.web_fetch_requests` — token-only today (no per-request charge). */
  readonly webFetchRequests: number;
}

/**
 * One attributed agent run (one assistant message, in Claude Code terms).
 * This is the atomic ledger record — metadata only.
 */
export interface RunEvent {
  /**
   * Stable id used for de-duplication, identifying the billable unit (the API
   * request). Prefers `requestId`; falls back to the message uuid, then
   * `sessionId:timestamp`, only when no request id is present.
   */
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
  /** True when this run was a subagent / sidechain turn rather than the main thread. */
  readonly isSidechain: boolean;
  /** Server-tool request counts (web search / fetch), billed on top of tokens. */
  readonly serverTools: ServerToolUse;
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

/**
 * Per-request rates for Anthropic server tools, in USD per request. These are
 * flat per-request charges (not per-model, not per-token), so they live on the
 * table rather than on ModelRates.
 */
export interface ServerToolRates {
  /** USD per web_search request (Anthropic: $10 / 1,000 searches = $0.01). */
  readonly webSearchPerRequest: number;
  /** USD per web_fetch request (Anthropic: no additional charge — token-only). */
  readonly webFetchPerRequest: number;
  /** True when these rates have been confirmed against the vendor price list. */
  readonly verified: boolean;
}

/** A dated, sourced price list. Cost is computed, never read from telemetry. */
export interface PricingTable {
  readonly asOf: string;
  readonly source: string;
  readonly currency: 'USD';
  readonly models: Readonly<Record<string, ModelRates>>;
  /** Per-request server-tool rates (web search / fetch). */
  readonly serverTools: ServerToolRates;
}

/** Computed cost for one usage record. */
export interface CostBreakdown {
  readonly inputUsd: number;
  readonly outputUsd: number;
  readonly cacheReadUsd: number;
  readonly cacheWriteUsd: number;
  /** Cost of separately-billed server tools (web search) used in the run. */
  readonly serverToolUsd: number;
  readonly totalUsd: number;
  /** A rate was found for the model. */
  readonly priced: boolean;
  /** The rate is a best-effort estimate, not verified against the vendor price list. */
  readonly estimated: boolean;
}
