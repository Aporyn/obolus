import type { RateLimitSnapshot, RunEvent } from '../domain/types.js';
import { scanTranscripts } from './transcript-scanner.js';
import { scanCodexSessions } from './codex-scanner.js';
import { claudeProjectsDir, codexSessionsDir } from './paths.js';

/** Local-history roots per vendor. Defaults to each vendor's standard location. */
export interface ScanRoots {
  readonly claude?: string;
  readonly codex?: string;
}

/** The latest rate-limit snapshot per vendor (newest `capturedAt` wins). */
function newestPerVendor(snapshots: readonly RateLimitSnapshot[]): RateLimitSnapshot[] {
  const byVendor = new Map<string, RateLimitSnapshot>();
  for (const snap of snapshots) {
    const prev = byVendor.get(snap.vendor);
    if (!prev || snap.capturedAt > prev.capturedAt) byVendor.set(snap.vendor, snap);
  }
  return [...byVendor.values()];
}

/**
 * Scan every supported vendor's local history and return one merged,
 * vendor-tagged RunEvent[]. Each reader de-dups within its own vendor; ids are
 * namespaced per vendor so they never collide across vendors.
 */
export async function scanAll(roots: ScanRoots = {}): Promise<RunEvent[]> {
  const { events } = await scanAllWithMeta(roots);
  return events;
}

/**
 * Like `scanAll`, but also returns the latest account-level rate-limit snapshot
 * per vendor (Codex reports these; Claude Code does not).
 */
export async function scanAllWithMeta(
  roots: ScanRoots = {},
): Promise<{ events: RunEvent[]; rateLimits: RateLimitSnapshot[] }> {
  const [claudeEvents, codex] = await Promise.all([
    scanTranscripts(roots.claude ?? claudeProjectsDir()),
    scanCodexSessions(roots.codex ?? codexSessionsDir()),
  ]);
  return {
    events: [...claudeEvents, ...codex.events],
    rateLimits: newestPerVendor(codex.rateLimits),
  };
}
