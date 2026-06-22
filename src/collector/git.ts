import { execFileSync } from 'node:child_process';

interface CacheEntry {
  sha: string | null;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 3000;

/**
 * Short commit SHA currently checked out in `cwd`, or null if it is not a git
 * repo. Uses `git` via execFile (no shell). Cached briefly so a burst of runs
 * from the same repo does not spawn git repeatedly, while still picking up new
 * commits within a few seconds.
 */
export function currentCommit(cwd: string, now: number = Date.now()): string | null {
  if (!cwd) return null;
  const hit = cache.get(cwd);
  if (hit && now - hit.at < TTL_MS) return hit.sha;

  let sha: string | null = null;
  try {
    const out = execFileSync('git', ['-C', cwd, 'rev-parse', '--short=8', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    sha = out.trim() || null;
  } catch {
    sha = null;
  }
  cache.set(cwd, { sha, at: now });
  return sha;
}
