import { describe, it, expect } from 'vitest';
import type { RunEvent } from '../src/domain/types.js';
import { summarize } from '../src/report/aggregate.js';
import { ANTHROPIC_PRICING } from '../src/pricing/pricing-table.js';
import { displayWidth, pad, renderSummary, type RenderOptions } from '../src/report/terminal.js';

const BASE_OPTS: RenderOptions = {
  by: 'repo',
  top: 12,
  since: null,
  until: null,
  repo: null,
  branch: null,
  model: null,
};

function makeEvent(over: Partial<RunEvent> = {}): RunEvent {
  return {
    id: over.id ?? 'id1',
    vendor: 'claude-code',
    model: over.model ?? 'claude-opus-4-8',
    usage: over.usage ?? {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
    },
    repoPath: over.repoPath ?? '/Users/x/repoA',
    repo: over.repo ?? 'repoA',
    branch: over.branch ?? 'main',
    sessionId: over.sessionId ?? 's1',
    requestId: over.requestId ?? 'r1',
    timestamp: over.timestamp ?? '2026-05-01T00:00:00Z',
    toolVersion: null,
    isSidechain: over.isSidechain ?? false,
  };
}

describe('displayWidth / pad (CJK-aware)', () => {
  it('counts CJK characters as two columns', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('檢舉')).toBe(4);
    expect(displayWidth('a檢')).toBe(3);
  });

  it('pads to a fixed display width regardless of script', () => {
    expect(displayWidth(pad('檢舉', 26))).toBe(26);
    expect(displayWidth(pad('repoA', 26))).toBe(26);
  });

  it('truncates over-wide strings to the target display width', () => {
    expect(displayWidth(pad('檢舉測試專案名稱很長', 8))).toBe(8);
  });
});

describe('renderSummary', () => {
  it('shows the wedge banner with repo/session count and date span', () => {
    const events = [
      makeEvent({ id: 'a', repo: 'repoA', sessionId: 's1', timestamp: '2026-05-01T00:00:00Z' }),
      makeEvent({ id: 'b', repo: 'repoB', sessionId: 's2', timestamp: '2026-06-10T00:00:00Z' }),
    ];
    const out = renderSummary(summarize(events, ANTHROPIC_PRICING), ANTHROPIC_PRICING, BASE_OPTS);
    expect(out).toContain('2 repos');
    expect(out).toContain('2 sessions');
    expect(out).toContain('2026-05-01 → 2026-06-10');
    expect(out).toContain("history /usage can't show");
  });

  it('formats billions of tokens with a B suffix', () => {
    const event = makeEvent({
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 2_000_000_000,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
      },
    });
    const out = renderSummary(summarize([event], ANTHROPIC_PRICING), ANTHROPIC_PRICING, BASE_OPTS);
    expect(out).toContain('2.0B');
  });

  it('onboards a brand-new user when there is no history at all', () => {
    const out = renderSummary(summarize([], ANTHROPIC_PRICING), ANTHROPIC_PRICING, {
      ...BASE_OPTS,
      noHistory: true,
    });
    expect(out).toContain('No Claude Code history found');
    expect(out).not.toContain('No runs match this scope');
  });

  it('tells the user to widen filters when history exists but the scope is empty', () => {
    const out = renderSummary(summarize([], ANTHROPIC_PRICING), ANTHROPIC_PRICING, {
      ...BASE_OPTS,
      noHistory: false,
    });
    expect(out).toContain('No runs match this scope');
    expect(out).not.toContain('No Claude Code history found');
  });
});
