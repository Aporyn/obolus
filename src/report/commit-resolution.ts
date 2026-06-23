import type { RunEvent } from '../domain/types.js';
import type { LiveRecord } from '../ledger/live-ledger.js';
import type { CommitInfo, GitHistory, TagInfo } from '../collector/git-history.js';

/** How a run was attributed to a commit. */
export type Confidence = 'exact' | 'estimated' | 'unattributed';

/** The commit/release a run's cost is attributed to, with provenance. */
export interface Attribution {
  /** Short SHA, or null when the run can't be tied to a commit. */
  readonly commit: string | null;
  readonly subject: string;
  readonly committedAt: string;
  /** Tag name, or null when the commit is not yet in any release. */
  readonly release: string | null;
  readonly confidence: Confidence;
}

/**
 * Index live records for joining onto scanned runs. Prefer the exact run id
 * (added by `watch`); fall back to `(sessionId, ts)` for older ledger lines.
 */
function indexLive(records: readonly LiveRecord[]): Map<string, LiveRecord> {
  const map = new Map<string, LiveRecord>();
  for (const r of records) {
    map.set(`ts:${r.sessionId}|${r.ts}`, r);
    if (r.id) map.set(`id:${r.id}`, r);
  }
  return map;
}

/** The commit that captured a run: the earliest commit dated at/after the run. */
function capturingCommit(commits: readonly CommitInfo[], tsMs: number): CommitInfo | null {
  for (const c of commits) if (c.committedAtMs >= tsMs) return c;
  return null;
}

/** The release a commit belongs to: the earliest tag dated at/after the commit. */
function releaseFor(tags: readonly TagInfo[], committedAtMs: number): string | null {
  if (!Number.isFinite(committedAtMs)) return null;
  for (const t of tags) if (t.taggedAtMs >= committedAtMs) return t.tag;
  return null;
}

const UNATTRIBUTED: Attribution = {
  commit: null,
  subject: '',
  committedAt: '',
  release: null,
  confidence: 'unattributed',
};

/**
 * Resolve each run's commit + release. Exact (live-stamped) wins; otherwise
 * reconstruct from git history by bracketing the run's timestamp; otherwise
 * leave it unattributed. Pure given the injected `git` provider.
 */
export function resolveAttribution(
  events: readonly RunEvent[],
  liveRecords: readonly LiveRecord[],
  git: GitHistory,
): Map<string, Attribution> {
  const live = indexLive(liveRecords);
  const result = new Map<string, Attribution>();

  for (const ev of events) {
    const commits = git.commits(ev.repoPath, ev.branch);
    const tags = git.tags(ev.repoPath);

    // 1. exact — a live record stamped this run's commit at run time.
    const stamped = (ev.id ? live.get(`id:${ev.id}`) : undefined) ?? live.get(`ts:${ev.sessionId}|${ev.timestamp}`);
    if (stamped?.commit) {
      const meta = commits.find((c) => c.sha === stamped.commit);
      const committedAt = meta?.committedAt ?? '';
      result.set(ev.id, {
        commit: stamped.commit,
        subject: meta?.subject ?? '',
        committedAt,
        release: meta ? releaseFor(tags, meta.committedAtMs) : null,
        confidence: 'exact',
      });
      continue;
    }

    // 2. estimated — reconstruct from git history.
    const tsMs = Date.parse(ev.timestamp);
    const cap = Number.isFinite(tsMs) ? capturingCommit(commits, tsMs) : null;
    if (cap) {
      result.set(ev.id, {
        commit: cap.sha,
        subject: cap.subject,
        committedAt: cap.committedAt,
        release: releaseFor(tags, cap.committedAtMs),
        confidence: 'estimated',
      });
      continue;
    }

    // 3. unattributed — no repo / detached / work not yet committed (WIP).
    result.set(ev.id, UNATTRIBUTED);
  }

  return result;
}
