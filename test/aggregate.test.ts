import { describe, it, expect } from 'vitest';
import { summarize } from '../src/report/aggregate.js';
import type { PricingTable, RunEvent } from '../src/domain/types.js';

const table: PricingTable = {
  asOf: 'test',
  source: 'test',
  currency: 'USD',
  models: {
    known: {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite5m: 3.75,
      cacheWrite1h: 6,
      verified: true,
    },
  },
};

let counter = 0;
function ev(over: Partial<RunEvent> = {}): RunEvent {
  counter += 1;
  return {
    id: `id-${counter}`,
    vendor: 'claude-code',
    model: 'known',
    usage: {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
    },
    repoPath: '/x/repoA',
    repo: 'repoA',
    branch: null,
    sessionId: 's1',
    requestId: 'r',
    timestamp: '2026-06-01T00:00:00Z',
    toolVersion: null,
    ...over,
  };
}

describe('summarize', () => {
  it('totals cost and tokens by repo', () => {
    const s = summarize([ev(), ev()], table);
    expect(s.totalRuns).toBe(2);
    expect(s.totalCostUsd).toBeCloseTo(6);
    expect(s.byRepo[0]?.key).toBe('repoA');
    expect(s.byRepo[0]?.costUsd).toBeCloseTo(6);
    expect(s.byRepo[0]?.runs).toBe(2);
  });

  it('separates repos and ranks by cost', () => {
    const s = summarize([ev({ repo: 'small' }), ev({ repo: 'big' }), ev({ repo: 'big' })], table);
    expect(s.byRepo[0]?.key).toBe('big');
    expect(s.byRepo[1]?.key).toBe('small');
  });

  it('groups by branch, mapping null to a placeholder', () => {
    const s = summarize([ev({ branch: 'main' }), ev({ branch: 'main' }), ev({ branch: null })], table);
    expect(s.byBranch[0]?.key).toBe('main');
    expect(s.byBranch[0]?.runs).toBe(2);
    expect(s.byBranch.some((b) => b.key === '(detached/none)')).toBe(true);
  });

  it('rolls up sessions with time span and repo/branch context', () => {
    const s = summarize(
      [
        ev({ sessionId: 'sX', branch: 'feat', timestamp: '2026-06-02T10:00:00Z' }),
        ev({ sessionId: 'sX', branch: 'feat', timestamp: '2026-06-02T12:00:00Z' }),
      ],
      table,
    );
    const session = s.sessions.find((x) => x.key === 'sX');
    expect(session?.runs).toBe(2);
    expect(session?.repo).toBe('repoA');
    expect(session?.branch).toBe('feat');
    expect(session?.firstSeen).toBe('2026-06-02T10:00:00Z');
    expect(session?.lastSeen).toBe('2026-06-02T12:00:00Z');
  });

  it('flags unpriced models and excludes them from cost', () => {
    const s = summarize([ev({ model: 'mystery' })], table);
    expect(s.unpricedModels).toContain('mystery');
    expect(s.totalCostUsd).toBe(0);
    expect(s.byModel[0]?.hasUnpriced).toBe(true);
  });
});
