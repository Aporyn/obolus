const UNIT_MS = {
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
} as const;

type Unit = keyof typeof UNIT_MS;

const RELATIVE_SPAN = /^(\d+)([hdw])$/;

/**
 * Parse a `--since` value into an ISO cutoff timestamp.
 * Accepts a relative span (`12h`, `7d`, `2w`) or an absolute date (`2026-06-01`).
 * Returns null when the input cannot be parsed.
 */
export function parseSince(input: string, now: Date = new Date()): string | null {
  const trimmed = input.trim();
  const relative = trimmed.match(RELATIVE_SPAN);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = (relative[2] ?? 'd') as Unit;
    return new Date(now.getTime() - amount * UNIT_MS[unit]).toISOString();
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return null;
}
