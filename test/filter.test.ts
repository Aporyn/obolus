import { describe, it, expect } from 'vitest';
import { filterEvents } from '../src/report/filter.js';
import type { RunEvent } from '../src/domain/types.js';

function ev(over: Partial<RunEvent>): RunEvent {
  return {
    id: 'id',
    vendor: 'claude-code',
    model: 'm',
    usage: {
      inputTokens: 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
    },
    repoPath: '/x/r',
    repo: 'r',
    branch: null,
    sessionId: 's',
    requestId: null,
    timestamp: '2026-06-10T00:00:00Z',
    toolVersion: null,
    isSidechain: false,
    ...over,
  };
}

describe('filterEvents', () => {
  it('keeps everything when no options are given', () => {
    const events = [ev({}), ev({})];
    expect(filterEvents(events, {})).toHaveLength(2);
  });

  it('keeps only runs at or after the since cutoff', () => {
    const events = [ev({ timestamp: '2026-06-01T00:00:00Z' }), ev({ timestamp: '2026-06-20T00:00:00Z' })];
    const kept = filterEvents(events, { since: '2026-06-15T00:00:00Z' });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.timestamp).toBe('2026-06-20T00:00:00Z');
  });

  it('keeps only runs at or before the until cutoff', () => {
    const events = [ev({ timestamp: '2026-06-01T00:00:00Z' }), ev({ timestamp: '2026-06-20T00:00:00Z' })];
    const kept = filterEvents(events, { until: '2026-06-15T00:00:00Z' });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.timestamp).toBe('2026-06-01T00:00:00Z');
  });

  it('filters by repo, branch, and model', () => {
    const events = [
      ev({ repo: 'a', branch: 'main', model: 'opus' }),
      ev({ repo: 'b', branch: 'dev', model: 'sonnet' }),
    ];
    expect(filterEvents(events, { repo: 'b' })[0]?.repo).toBe('b');
    expect(filterEvents(events, { branch: 'main' })[0]?.repo).toBe('a');
    expect(filterEvents(events, { model: 'sonnet' })[0]?.repo).toBe('b');
  });

  it('drops runs with no timestamp when a since cutoff is set', () => {
    const events = [ev({ timestamp: '' })];
    expect(filterEvents(events, { since: '2026-01-01T00:00:00Z' })).toHaveLength(0);
  });
});
