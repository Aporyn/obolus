import { describe, it, expect } from 'vitest';
import { parseSince } from '../src/report/timeframe.js';

const now = new Date('2026-06-22T00:00:00Z');

describe('parseSince', () => {
  it('parses a relative day span', () => {
    expect(parseSince('7d', now)).toBe('2026-06-15T00:00:00.000Z');
  });

  it('parses hours and weeks', () => {
    expect(parseSince('12h', now)).toBe('2026-06-21T12:00:00.000Z');
    expect(parseSince('2w', now)).toBe('2026-06-08T00:00:00.000Z');
  });

  it('parses an absolute date', () => {
    expect(parseSince('2026-06-01', now)).toBe('2026-06-01T00:00:00.000Z');
  });

  it('returns null for unparseable input', () => {
    expect(parseSince('last tuesday', now)).toBeNull();
    expect(parseSince('', now)).toBeNull();
  });
});
