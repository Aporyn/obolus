import type { RunEvent } from '../domain/types.js';

export interface FilterOptions {
  /** ISO cutoff — keep runs at or after this timestamp. */
  readonly since?: string | null;
  /** Repo label — keep only runs in this repo (exact match). */
  readonly repo?: string | null;
}

/** Narrow run events by time window and/or repo. Pure; returns a new array. */
export function filterEvents(events: readonly RunEvent[], opts: FilterOptions): RunEvent[] {
  const { since, repo } = opts;
  return events.filter((event) => {
    if (since && (!event.timestamp || event.timestamp < since)) return false;
    if (repo && event.repo !== repo) return false;
    return true;
  });
}
