import type { PricingTable } from '../domain/types.js';
import type { GroupTotals, RunRef, ScanSummary, SessionTotals } from './aggregate.js';

export type GroupDimension = 'repo' | 'model' | 'branch' | 'day' | 'week' | 'kind';

export interface RenderOptions {
  readonly by: GroupDimension;
  readonly top: number;
  readonly since: string | null;
  readonly until: string | null;
  readonly repo: string | null;
  readonly branch: string | null;
  readonly model: string | null;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${((100 * part) / whole).toFixed(0)}%`;
}

function pad(s: string, width: number): string {
  if (s.length > width) return `${s.slice(0, width - 1)}…`;
  return s.padEnd(width);
}

function day(iso: string): string {
  return iso ? iso.slice(0, 10) : '—';
}

// Time dimensions read best oldest→newest; everything else ranks by cost.
const CHRONOLOGICAL: ReadonlySet<GroupDimension> = new Set<GroupDimension>(['day', 'week']);

function groupFor(summary: ScanSummary, by: GroupDimension): readonly GroupTotals[] {
  switch (by) {
    case 'model':
      return summary.byModel;
    case 'branch':
      return summary.byBranch;
    case 'day':
      return summary.byDay;
    case 'week':
      return summary.byWeek;
    case 'kind':
      return summary.byKind;
    default:
      return summary.byRepo;
  }
}

function row(g: GroupTotals): string {
  const flag = g.hasUnpriced ? '  ⚠ unpriced' : g.hasEstimated ? '  ~ est.' : '';
  return `  ${pad(g.key, 26)} ${fmtUsd(g.costUsd).padStart(10)}  ${fmtTokens(g.totalTokens).padStart(8)}  ${String(g.runs).padStart(5)} runs${flag}`;
}

function sessionRow(s: SessionTotals): string {
  const where = s.branch ? `${s.repo}/${s.branch}` : s.repo;
  const span = s.firstSeen ? `${day(s.firstSeen)}→${day(s.lastSeen)}` : '—';
  return `  ${pad(where, 24)} ${fmtUsd(s.costUsd).padStart(10)}  ${fmtTokens(s.totalTokens).padStart(8)}  ${String(s.runs).padStart(4)}r  ${span}  ${s.key.slice(0, 8)}`;
}

function runRow(r: RunRef): string {
  const where = r.branch ? `${r.repo}/${r.branch}` : r.repo;
  const tag = r.isSidechain ? ' [sub]' : '';
  return `  ${pad(where, 22)} ${fmtUsd(r.costUsd).padStart(9)}  ${fmtTokens(r.totalTokens).padStart(7)}  ${day(r.timestamp)}  ${r.model}${tag}`;
}

/** Render a scan summary as a plain-text terminal report (no color dependency). */
export function renderSummary(
  summary: ScanSummary,
  table: PricingTable,
  opts: RenderOptions,
): string {
  const lines: string[] = [];
  lines.push('Obolus — local AI coding-agent spend (Claude Code)');

  const scope: string[] = [];
  if (opts.since) scope.push(`since ${day(opts.since)}`);
  if (opts.until) scope.push(`until ${day(opts.until)}`);
  if (opts.repo) scope.push(`repo ${opts.repo}`);
  if (opts.branch) scope.push(`branch ${opts.branch}`);
  if (opts.model) scope.push(`model ${opts.model}`);
  if (scope.length > 0) lines.push(`  scope: ${scope.join(', ')}`);
  lines.push('');

  if (summary.totalRuns === 0) {
    lines.push('  No runs match this scope.');
    return lines.join('\n');
  }

  lines.push(
    `  Runs ${summary.totalRuns.toLocaleString()}   Tokens ${fmtTokens(summary.totalTokens)}   Est. cost ${fmtUsd(summary.totalCostUsd)}`,
  );

  const c = summary.composition;
  lines.push(
    `  Where it goes: input ${fmtUsd(c.inputUsd)} · output ${fmtUsd(c.outputUsd)} · cache-read ${fmtUsd(c.cacheReadUsd)} · cache-write ${fmtUsd(c.cacheWriteUsd)}`,
  );
  const subagent = summary.byKind.find((k) => k.key === 'subagent');
  if (subagent) {
    lines.push(
      `  Subagent (sidechain) share: ${fmtUsd(subagent.costUsd)} (${pct(subagent.costUsd, summary.totalCostUsd)})`,
    );
  }

  const groups = groupFor(summary, opts.by);
  const shown = CHRONOLOGICAL.has(opts.by) ? groups.slice(-opts.top) : groups.slice(0, opts.top);
  lines.push('');
  lines.push(`By ${opts.by}:`);
  for (const g of shown) lines.push(row(g));

  lines.push('');
  lines.push('Top sessions by cost:');
  for (const s of summary.sessions.slice(0, opts.top)) lines.push(sessionRow(s));

  lines.push('');
  lines.push('Most expensive runs:');
  for (const r of summary.topRuns.slice(0, opts.top)) lines.push(runRow(r));

  lines.push('');
  if (summary.unpricedModels.length > 0) {
    lines.push(
      `⚠ No pricing for: ${summary.unpricedModels.join(', ')} — add rates in pricing-table.ts (cost shown as $0 for these).`,
    );
  }
  if (summary.estimatedModels.length > 0) {
    lines.push(`~ Estimated (unverified) rates for: ${summary.estimatedModels.join(', ')}`);
  }
  lines.push(
    `Cost = tokens × local rate table (asOf ${table.asOf}). An estimate, not your actual bill.`,
  );
  return lines.join('\n');
}
