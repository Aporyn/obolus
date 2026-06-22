import type { RunEvent } from '../domain/types.js';

export interface FilterOptions {
  /** ISO cutoff — keep runs at or after this timestamp. */
  readonly since?: string | null;
  /** ISO cutoff — keep runs at or before this timestamp. */
  readonly until?: string | null;
  /** Repo label — keep only runs in this repo (exact match). */
  readonly repo?: string | null;
  /** Branch name — keep only runs on this branch (exact match). */
  readonly branch?: string | null;
  /** Model id — keep only runs on this model (exact match). */
  readonly model?: string | null;
}

/** Narrow run events by time window, repo, branch, and/or model. Pure; returns a new array. */
export function filterEvents(events: readonly RunEvent[], opts: FilterOptions): RunEvent[] {
  const { since, until, repo, branch, model } = opts;
  return events.filter((event) => {
    if (since && (!event.timestamp || event.timestamp < since)) return false;
    if (until && (!event.timestamp || event.timestamp > until)) return false;
    if (repo && event.repo !== repo) return false;
    if (branch && (event.branch ?? '') !== branch) return false;
    if (model && event.model !== model) return false;
    return true;
  });
}
