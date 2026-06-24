import { tailRuns, type LiveRun, type TailOptions } from './tailer.js';
import { tailCodexSessions } from './codex-scanner.js';
import { claudeProjectsDir, codexSessionsDir } from './paths.js';
import type { ScanRoots } from './scan-all.js';

/**
 * Tail every supported vendor's active local history concurrently, forwarding
 * each new run to a single `onRun` callback. Consumers stay vendor-agnostic —
 * `LiveRun.event.vendor` carries identity and pricing is already per-vendor.
 * Stops when `isStopped()` returns true. Metadata only.
 */
export async function tailAll(
  roots: ScanRoots,
  onRun: (run: LiveRun) => void | Promise<void>,
  isStopped: () => boolean,
  opts: TailOptions = {},
): Promise<void> {
  await Promise.all([
    tailRuns(roots.claude ?? claudeProjectsDir(), onRun, isStopped, opts),
    tailCodexSessions(roots.codex ?? codexSessionsDir(), onRun, isStopped, opts),
  ]);
}
