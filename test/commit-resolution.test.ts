import { describe, it, expect } from 'vitest';
import type { RunEvent } from '../src/domain/types.js';
import type { LiveRecord } from '../src/ledger/live-ledger.js';
import type { CommitInfo, GitHistory, TagInfo } from '../src/collector/git-history.js';
import { resolveAttribution } from '../src/report/commit-resolution.js';

function ev(p: { id: string; timestamp: string; repoPath?: string; branch?: string | null; sessionId?: string }): RunEvent {
  return {
    id: p.id,
    vendor: 'claude-code',
    model: 'claude-opus-4-8',
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 },
    repoPath: p.repoPath ?? '/r/repoA',
    repo: 'repoA',
    branch: p.branch === undefined ? 'main' : p.branch,
    sessionId: p.sessionId ?? 's1',
    requestId: null,
    timestamp: p.timestamp,
    toolVersion: null,
    isSidechain: false,
    serverTools: { webSearchRequests: 0, webFetchRequests: 0 },
  };
}

function commit(sha: string, iso: string, subject: string): CommitInfo {
  return { sha, committedAt: iso, committedAtMs: Date.parse(iso), subject };
}
function tag(name: string, iso: string): TagInfo {
  return { tag: name, taggedAt: iso, taggedAtMs: Date.parse(iso) };
}
function fakeGit(commits: CommitInfo[], tags: TagInfo[] = []): GitHistory {
  return {
    commits: (repoPath, branch) => (repoPath === '/r/repoA' && branch === 'main' ? commits : []),
    tags: (repoPath) => (repoPath === '/r/repoA' ? tags : []),
  };
}

const commits = [
  commit('aaaaaaaa', '2026-06-01T10:00:00Z', 'first'),
  commit('bbbbbbbb', '2026-06-02T10:00:00Z', 'second'),
  commit('cccccccc', '2026-06-03T10:00:00Z', 'third'),
];

describe('resolveAttribution', () => {
  it('estimates by bracketing: a run is attributed to the capturing (next) commit', () => {
    const a = resolveAttribution([ev({ id: 'r1', timestamp: '2026-06-01T15:00:00Z' })], [], fakeGit(commits)).get('r1');
    expect(a?.commit).toBe('bbbbbbbb');
    expect(a?.confidence).toBe('estimated');
    expect(a?.subject).toBe('second');
  });

  it('a run before the first commit attributes to the first commit', () => {
    const a = resolveAttribution([ev({ id: 'r0', timestamp: '2026-06-01T00:00:00Z' })], [], fakeGit(commits)).get('r0');
    expect(a?.commit).toBe('aaaaaaaa');
  });

  it('exact (live-stamped) wins over reconstruction, joined by id, enriched from history', () => {
    const live: LiveRecord[] = [
      { id: 'r1', ts: '2026-06-01T15:00:00Z', repo: 'repoA', repoPath: '/r/repoA', branch: 'main', commit: 'cccccccc', model: 'm', sessionId: 's1', costUsd: 1, tokens: 2, isSidechain: false },
    ];
    const a = resolveAttribution([ev({ id: 'r1', timestamp: '2026-06-01T15:00:00Z' })], live, fakeGit(commits)).get('r1');
    expect(a?.commit).toBe('cccccccc');
    expect(a?.confidence).toBe('exact');
    expect(a?.subject).toBe('third');
  });

  it('joins live records by (sessionId, ts) when id is absent (legacy lines)', () => {
    const live: LiveRecord[] = [
      { ts: '2026-06-02T15:00:00Z', repo: 'repoA', repoPath: '/r/repoA', branch: 'main', commit: 'aaaaaaaa', model: 'm', sessionId: 's7', costUsd: 1, tokens: 2, isSidechain: false },
    ];
    const a = resolveAttribution([ev({ id: 'r9', sessionId: 's7', timestamp: '2026-06-02T15:00:00Z' })], live, fakeGit(commits)).get('r9');
    expect(a?.commit).toBe('aaaaaaaa');
    expect(a?.confidence).toBe('exact');
  });

  it('marks WIP runs after the last commit as unattributed', () => {
    const a = resolveAttribution([ev({ id: 'rw', timestamp: '2026-06-04T10:00:00Z' })], [], fakeGit(commits)).get('rw');
    expect(a?.commit).toBeNull();
    expect(a?.confidence).toBe('unattributed');
  });

  it('marks runs with no git history (non-repo / detached) as unattributed', () => {
    const noRepo = resolveAttribution([ev({ id: 'rn', repoPath: '/r/other', timestamp: '2026-06-01T15:00:00Z' })], [], fakeGit(commits)).get('rn');
    expect(noRepo?.confidence).toBe('unattributed');
    const detached = resolveAttribution([ev({ id: 'rd', branch: null, timestamp: '2026-06-01T15:00:00Z' })], [], fakeGit(commits)).get('rd');
    expect(detached?.confidence).toBe('unattributed');
  });

  it('maps a commit to the earliest tag at/after it; else unreleased', () => {
    const tags = [tag('v1', '2026-06-02T12:00:00Z')];
    const m = resolveAttribution(
      [ev({ id: 'rt1', timestamp: '2026-06-01T15:00:00Z' }), ev({ id: 'rt2', timestamp: '2026-06-02T15:00:00Z' })],
      [],
      fakeGit(commits, tags),
    );
    expect(m.get('rt1')?.release).toBe('v1'); // → commit bbbb (06-02 10:00) ≤ v1 (06-02 12:00)
    expect(m.get('rt2')?.release).toBeNull(); // → commit cccc (06-03 10:00) after v1 → unreleased
  });

  it('compares instants across timezones, not ISO strings', () => {
    // +08:00 commit at 18:00 local == 10:00Z; a run at 09:00Z precedes it.
    const tzCommits = [commit('dddddddd', '2026-06-01T18:00:00+08:00', 'tz')];
    const a = resolveAttribution([ev({ id: 'rz', timestamp: '2026-06-01T09:00:00Z' })], [], fakeGit(tzCommits)).get('rz');
    expect(a?.commit).toBe('dddddddd');
  });
});
