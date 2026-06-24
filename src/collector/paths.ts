import { homedir } from 'node:os';
import { join } from 'node:path';

/** Root where Claude Code stores per-project transcripts. */
export function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Root where OpenAI Codex CLI stores per-session rollout files
 * (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`). Honors `CODEX_HOME`.
 */
export function codexSessionsDir(): string {
  const home = process.env.CODEX_HOME && process.env.CODEX_HOME.trim()
    ? process.env.CODEX_HOME
    : join(homedir(), '.codex');
  return join(home, 'sessions');
}

/** Obolus local data dir (ledger, cache). Cross-repo, lives in the user's home. */
export function obolusHome(): string {
  return join(homedir(), '.obolus');
}

/**
 * Claude Code encodes a project's working directory as a single dir name by
 * replacing path separators with '-'. That encoding is not safely reversible
 * (real names may contain '-'), so we treat it as opaque and instead prefer the
 * `cwd` recorded inside each transcript line. This derives the friendly label.
 */
export function repoLabelFromCwd(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}
