import type { PricingTable } from '../domain/types.js';
import type {
  CommitTotals,
  GroupTotals,
  ReleaseTotals,
  RunRef,
  ScanSummary,
  SessionTotals,
} from './aggregate.js';

export type GroupDimension = 'repo' | 'model' | 'branch' | 'day' | 'week' | 'kind' | 'commit' | 'release';

export interface RenderOptions {
  readonly by: GroupDimension;
  readonly top: number;
  readonly since: string | null;
  readonly until: string | null;
  readonly repo: string | null;
  readonly branch: string | null;
  readonly model: string | null;
  /** True when the local Claude Code history is empty (not just this filter). */
  readonly noHistory?: boolean;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Code points that occupy two terminal columns (CJK, Hangul, fullwidth, emoji). */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Display columns a string occupies in a monospace terminal. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += isWide(ch.codePointAt(0) ?? 0) ? 2 : 1;
  return w;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${((100 * part) / whole).toFixed(0)}%`;
}

export function pad(s: string, width: number): string {
  const w = displayWidth(s);
  if (w <= width) return s + ' '.repeat(width - w);
  // Truncate by display width, leaving one column for the ellipsis.
  let out = '';
  let acc = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (acc + cw > width - 1) break;
    out += ch;
    acc += cw;
  }
  return `${out}…${' '.repeat(Math.max(0, width - acc - 1))}`;
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
    case 'commit':
      return summary.byCommit;
    case 'release':
      return summary.byRelease;
    default:
      return summary.byRepo;
  }
}

function row(g: GroupTotals): string {
  const flag = g.hasUnpriced ? '  ⚠ unpriced' : g.hasEstimated ? '  ~ est.' : '';
  return `  ${pad(g.key, 26)} ${fmtUsd(g.costUsd).padStart(10)}  ${fmtTokens(g.totalTokens).padStart(8)}  ${String(g.runs).padStart(5)} runs${flag}`;
}

const UNATTRIBUTED_KEY = '(unattributed)';

function commitRow(c: CommitTotals): string {
  if (c.key === UNATTRIBUTED_KEY) {
    return `  ${pad(UNATTRIBUTED_KEY, 10)} ${pad('uncommitted / no git', 34)} ${fmtUsd(c.costUsd).padStart(10)}`;
  }
  const prov =
    c.exactUsd > 0 && c.estimatedUsd === 0
      ? 'exact'
      : c.estimatedUsd > 0 && c.exactUsd === 0
        ? '~est'
        : 'mixed';
  const rel = c.release ? `  (${c.release})` : '';
  return `  ${pad(c.key, 10)} ${pad(c.subject || '—', 34)} ${fmtUsd(c.costUsd).padStart(10)}  ${prov}${rel}`;
}

function releaseRow(r: ReleaseTotals): string {
  const span = r.firstCommitAt ? `${day(r.firstCommitAt)}→${day(r.lastCommitAt)}` : '—';
  const meta = r.key === UNATTRIBUTED_KEY ? '' : `  ${r.commitCount} commits  ${span}`;
  return `  ${pad(r.key, 16)} ${fmtUsd(r.costUsd).padStart(10)}${meta}`;
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
  lines.push('Obolus — local AI coding-agent spend (Claude Code + Codex)');

  const scope: string[] = [];
  if (opts.since) scope.push(`since ${day(opts.since)}`);
  if (opts.until) scope.push(`until ${day(opts.until)}`);
  if (opts.repo) scope.push(`repo ${opts.repo}`);
  if (opts.branch) scope.push(`branch ${opts.branch}`);
  if (opts.model) scope.push(`model ${opts.model}`);
  if (scope.length > 0) lines.push(`  scope: ${scope.join(', ')}`);
  lines.push('');

  if (summary.totalRuns === 0) {
    if (opts.noHistory) {
      lines.push('  No Claude Code history found yet (looked in ~/.claude/projects).');
      lines.push('');
      lines.push("  Obolus reads Claude Code's own local transcripts — nothing to enable, no");
      lines.push('  API key, no telemetry flag. Use Claude Code once, then run `obolus scan`');
      lines.push('  again to see your spend across every repo, branch and commit.');
    } else {
      lines.push('  No runs match this scope. Widen the filters above, or run `obolus scan`');
      lines.push('  with no flags to see your full history.');
    }
    return lines.join('\n');
  }

  lines.push(
    `  Runs ${summary.totalRuns.toLocaleString()}   Tokens ${fmtTokens(summary.totalTokens)}   Est. cost ${fmtUsd(summary.totalCostUsd)}`,
  );

  // The wedge in one line: persistent, cross-repo history that native /usage
  // (24h/7d, single machine) cannot show.
  const repos = summary.byRepo.length;
  const sessions = summary.sessions.length;
  const days = summary.byDay.map((d) => d.key).filter((k) => k !== 'unknown');
  const reach = [
    `${repos.toLocaleString()} ${repos === 1 ? 'repo' : 'repos'}`,
    `${sessions.toLocaleString()} ${sessions === 1 ? 'session' : 'sessions'}`,
  ];
  if (days.length > 0) reach.push(`${days[0]} → ${days[days.length - 1]}`);
  lines.push(`  Spanning ${reach.join(' · ')} — history /usage can't show`);

  const c = summary.composition;
  // Server tools (web search) are billed separately from tokens; only surface the
  // segment when some were actually used, to keep the common case uncluttered.
  const serverTools = c.serverToolUsd > 0 ? ` · server tools ${fmtUsd(c.serverToolUsd)}` : '';
  lines.push(
    `  Where it goes: input ${fmtUsd(c.inputUsd)} · output ${fmtUsd(c.outputUsd)} · cache-read ${fmtUsd(c.cacheReadUsd)} · cache-write ${fmtUsd(c.cacheWriteUsd)}${serverTools}`,
  );
  const subagent = summary.byKind.find((k) => k.key === 'subagent');
  if (subagent) {
    lines.push(
      `  Subagent (sidechain) share: ${fmtUsd(subagent.costUsd)} (${pct(subagent.costUsd, summary.totalCostUsd)})`,
    );
  }

  lines.push('');
  lines.push(`By ${opts.by}:`);
  if (opts.by === 'commit') {
    for (const c of summary.byCommit.slice(0, opts.top)) lines.push(commitRow(c));
  } else if (opts.by === 'release') {
    for (const r of summary.byRelease.slice(0, opts.top)) lines.push(releaseRow(r));
  } else {
    const groups = groupFor(summary, opts.by);
    const shown = CHRONOLOGICAL.has(opts.by) ? groups.slice(-opts.top) : groups.slice(0, opts.top);
    for (const g of shown) lines.push(row(g));
  }

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
