import { execFileSync } from 'node:child_process';

/** One commit on a branch. `committedAtMs` is the epoch for correct cross-timezone ordering. */
export interface CommitInfo {
  readonly sha: string;
  readonly committedAt: string;
  readonly committedAtMs: number;
  readonly subject: string;
}

/** One tag, dated by its creator/commit date. */
export interface TagInfo {
  readonly tag: string;
  readonly taggedAt: string;
  readonly taggedAtMs: number;
}

/** Read-only view of a repo's git history, injectable so resolution stays testable. */
export interface GitHistory {
  commits(repoPath: string, branch: string | null): readonly CommitInfo[];
  tags(repoPath: string): readonly TagInfo[];
}

const TTL_MS = 30_000;
const SEP = '\x00';
const commitCache = new Map<string, { at: number; value: CommitInfo[] }>();
const tagCache = new Map<string, { at: number; value: TagInfo[] }>();

/** Run git with no shell; returns stdout or null on any failure (non-repo, missing branch, …). */
function git(args: readonly string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 4000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Commits reachable from `branch` in `repoPath`, ascending by commit date. Empty if not a repo. */
export function commitsFor(repoPath: string, branch: string | null, now: number = Date.now()): CommitInfo[] {
  if (!repoPath || !branch) return [];
  const key = `${repoPath}${SEP}${branch}`;
  const hit = commitCache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  // `%x00` is a literal token in the arg — git expands it to a NUL byte in the
  // OUTPUT (a real NUL in the arg would truncate the C-string passed to execve).
  const out = git([
    '-C',
    repoPath,
    'log',
    branch,
    '--abbrev=8',
    '--pretty=format:%h%x00%cI%x00%s',
    '-n',
    '5000',
  ]);
  const value: CommitInfo[] = [];
  if (out) {
    for (const line of out.split('\n')) {
      const sep1 = line.indexOf(SEP);
      const sep2 = line.indexOf(SEP, sep1 + 1);
      if (sep1 < 0 || sep2 < 0) continue;
      const sha = line.slice(0, sep1);
      const committedAt = line.slice(sep1 + 1, sep2);
      const subject = line.slice(sep2 + 1);
      const committedAtMs = Date.parse(committedAt);
      if (sha && Number.isFinite(committedAtMs)) value.push({ sha, committedAt, committedAtMs, subject });
    }
    value.sort((a, b) => a.committedAtMs - b.committedAtMs);
  }
  commitCache.set(key, { at: now, value });
  return value;
}

/** Tags in `repoPath`, ascending by date. Empty if not a repo / no tags. */
export function tagsFor(repoPath: string, now: number = Date.now()): TagInfo[] {
  if (!repoPath) return [];
  const hit = tagCache.get(repoPath);
  if (hit && now - hit.at < TTL_MS) return hit.value;

  // A space separator is safe: git ref names cannot contain spaces and ISO dates have none.
  const out = git([
    '-C',
    repoPath,
    'for-each-ref',
    '--sort=creatordate',
    '--format=%(refname:short) %(creatordate:iso-strict)',
    'refs/tags',
  ]);
  const value: TagInfo[] = [];
  if (out) {
    for (const line of out.split('\n')) {
      const sep = line.indexOf(' ');
      if (sep < 0) continue;
      const tag = line.slice(0, sep);
      const taggedAt = line.slice(sep + 1);
      const taggedAtMs = Date.parse(taggedAt);
      if (tag && Number.isFinite(taggedAtMs)) value.push({ tag, taggedAt, taggedAtMs });
    }
    value.sort((a, b) => a.taggedAtMs - b.taggedAtMs);
  }
  tagCache.set(repoPath, { at: now, value });
  return value;
}

/** The process-default history provider, backed by the local `git` binary. */
export const defaultGitHistory: GitHistory = { commits: commitsFor, tags: tagsFor };
