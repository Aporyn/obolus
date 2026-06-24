import { describe, it, expect } from 'vitest';
import { summarize } from '../src/report/aggregate.js';
import type { PricingTable, RunEvent, TokenUsage } from '../src/domain/types.js';

// Day/week buckets are local-timezone (per-developer "today"). Pin a fixed zone (UTC+8) so the
// assertions are deterministic regardless of the machine/CI timezone.
process.env.TZ = 'Asia/Taipei';

const table: PricingTable = {
  asOf: 'test',
  source: 'test',
  currency: 'USD',
  serverTools: { webSearchPerRequest: 0.01, webFetchPerRequest: 0, verified: true },
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

const ONE_M_INPUT: TokenUsage = {
  inputTokens: 1_000_000,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
};

let counter = 0;
function ev(over: Partial<RunEvent> = {}): RunEvent {
  counter += 1;
  return {
    id: `id-${counter}`,
    vendor: 'claude-code',
    model: 'known',
    usage: ONE_M_INPUT,
    repoPath: '/x/repoA',
    repo: 'repoA',
    branch: null,
    sessionId: 's1',
    requestId: 'r',
    timestamp: '2026-06-01T00:00:00Z',
    toolVersion: null,
    isSidechain: false,
    serverTools: { webSearchRequests: 0, webFetchRequests: 0 },
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

  it('groups by day in chronological order', () => {
    const s = summarize(
      [
        ev({ timestamp: '2026-06-02T10:00:00Z' }),
        ev({ timestamp: '2026-06-01T10:00:00Z' }),
        ev({ timestamp: '2026-06-02T12:00:00Z' }),
      ],
      table,
    );
    expect(s.byDay.map((d) => d.key)).toEqual(['2026-06-01', '2026-06-02']);
    expect(s.byDay[1]?.runs).toBe(2);
    expect(s.byWeek.length).toBeGreaterThanOrEqual(1);
  });

  it('buckets days by the local clock, not UTC', () => {
    // 20:00Z on 06-01 is 04:00 on 06-02 in UTC+8 — it must land on the local day (06-02).
    const s = summarize([ev({ timestamp: '2026-06-01T20:00:00Z' })], table);
    expect(s.byDay[0]?.key).toBe('2026-06-02');
  });

  it('splits main vs subagent via byKind', () => {
    const s = summarize([ev(), ev({ isSidechain: true })], table);
    expect(s.byKind.find((k) => k.key === 'subagent')?.runs).toBe(1);
    expect(s.byKind.find((k) => k.key === 'main')?.runs).toBe(1);
  });

  it('ranks top runs by cost and records cost composition', () => {
    const cheap = ev({
      usage: {
        inputTokens: 1000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
      },
    });
    const pricey = ev({
      usage: {
        inputTokens: 0,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
      },
    });
    const s = summarize([cheap, pricey], table);
    expect(s.topRuns[0]?.costUsd).toBeCloseTo(15);
    expect(s.topRuns[0]?.costUsd).toBeGreaterThan(s.topRuns[1]?.costUsd ?? 0);
    expect(s.composition.outputUsd).toBeCloseTo(15);
    expect(s.composition.inputUsd).toBeCloseTo(0.003);
  });

  it('includes separately-billed server-tool cost in totals and composition', () => {
    // ONE_M_INPUT → $3 token cost; 10 web searches × $0.01 = $0.10 on top.
    const s = summarize(
      [ev({ serverTools: { webSearchRequests: 10, webFetchRequests: 0 } })],
      table,
    );
    expect(s.composition.serverToolUsd).toBeCloseTo(0.1);
    expect(s.totalCostUsd).toBeCloseTo(3.1);
    // Composition (now including server tools) still reconciles to the total.
    const c = s.composition;
    expect(c.inputUsd + c.outputUsd + c.cacheReadUsd + c.cacheWriteUsd + c.serverToolUsd).toBeCloseTo(
      s.totalCostUsd,
    );
  });

  it('flags unpriced models and excludes them from cost', () => {
    const s = summarize([ev({ model: 'mystery' })], table);
    expect(s.unpricedModels).toContain('mystery');
    expect(s.totalCostUsd).toBe(0);
    expect(s.byModel[0]?.hasUnpriced).toBe(true);
  });
});
