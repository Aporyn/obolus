import { describe, it, expect } from 'vitest';
import { summarize } from '../src/report/aggregate.js';
import type { Attribution } from '../src/report/commit-resolution.js';
import { ANTHROPIC_PRICING } from '../src/pricing/pricing-table.js';
import type { RunEvent } from '../src/domain/types.js';

function ev(id: string, timestamp: string): RunEvent {
  return {
    id,
    vendor: 'claude-code',
    model: 'claude-opus-4-8',
    usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 },
    repoPath: '/r/repoA',
    repo: 'repoA',
    branch: 'main',
    sessionId: 's1',
    requestId: null,
    timestamp,
    toolVersion: null,
    isSidechain: false,
    serverTools: { webSearchRequests: 0, webFetchRequests: 0 },
  };
}

const events = [
  ev('r1', '2026-06-01T10:00:00Z'),
  ev('r2', '2026-06-01T11:00:00Z'),
  ev('r3', '2026-06-04T10:00:00Z'),
];

const attribution = new Map<string, Attribution>([
  ['r1', { commit: 'aaaaaaaa', subject: 'first', committedAt: '2026-06-01T10:00:00Z', release: 'v1', confidence: 'exact' }],
  ['r2', { commit: 'aaaaaaaa', subject: 'first', committedAt: '2026-06-01T10:00:00Z', release: 'v1', confidence: 'estimated' }],
  ['r3', { commit: null, subject: '', committedAt: '', release: null, confidence: 'unattributed' }],
]);

describe('summarize with attribution', () => {
  it('folds byCommit with an exact/estimated split and conserves the total', () => {
    const s = summarize(events, ANTHROPIC_PRICING, { attribution });

    const aaaa = s.byCommit.find((c) => c.key === 'aaaaaaaa');
    expect(aaaa?.runs).toBe(2);
    expect(aaaa?.subject).toBe('first');
    expect(aaaa?.release).toBe('v1');
    expect((aaaa?.exactUsd ?? 0) > 0 && (aaaa?.estimatedUsd ?? 0) > 0).toBe(true);
    expect(Math.abs((aaaa?.exactUsd ?? 0) + (aaaa?.estimatedUsd ?? 0) - (aaaa?.costUsd ?? 0))).toBeLessThan(1e-9);

    const unattr = s.byCommit.find((c) => c.key === '(unattributed)');
    expect(unattr?.runs).toBe(1);

    // Conservation: sum(byCommit incl. unattributed) == total.
    const sumCommit = s.byCommit.reduce((acc, c) => acc + c.costUsd, 0);
    expect(Math.abs(sumCommit - s.totalCostUsd)).toBeLessThan(1e-9);
  });

  it('folds byRelease (tag / unattributed) and conserves the total', () => {
    const s = summarize(events, ANTHROPIC_PRICING, { attribution });

    const v1 = s.byRelease.find((r) => r.key === 'v1');
    expect(v1?.commitCount).toBe(1);
    expect(v1?.runs).toBe(2);

    const relUnattr = s.byRelease.find((r) => r.key === '(unattributed)');
    expect(relUnattr?.runs).toBe(1);

    const sumRel = s.byRelease.reduce((acc, r) => acc + r.costUsd, 0);
    expect(Math.abs(sumRel - s.totalCostUsd)).toBeLessThan(1e-9);
  });

  it('leaves byCommit/byRelease empty when no attribution is supplied', () => {
    const s = summarize(events, ANTHROPIC_PRICING);
    expect(s.byCommit).toEqual([]);
    expect(s.byRelease).toEqual([]);
  });
});
