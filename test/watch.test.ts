import { describe, it, expect } from 'vitest';
import { takeCompleteLines } from '../src/collector/watch.js';
import { currentCommit } from '../src/collector/git.js';

describe('takeCompleteLines', () => {
  it('returns complete lines and bytes consumed, holding back a partial tail', () => {
    const r = takeCompleteLines('a\nb\npartial');
    expect(r.lines).toEqual(['a', 'b']);
    expect(r.consumed).toBe(4); // 'a\nb\n'
  });

  it('returns nothing when there is no newline yet', () => {
    expect(takeCompleteLines('partial')).toEqual({ lines: [], consumed: 0 });
  });

  it('counts multibyte bytes correctly', () => {
    const r = takeCompleteLines('café\n');
    expect(r.lines).toEqual(['café']);
    expect(r.consumed).toBe(6); // 'café' = 5 bytes + '\n'
  });
});

describe('currentCommit', () => {
  it('returns a short sha for a git repo', () => {
    const sha = currentCommit(process.cwd());
    expect(sha === null || /^[0-9a-f]{7,}$/.test(sha)).toBe(true);
  });

  it('returns null for a path that is not a git repo', () => {
    expect(currentCommit('/')).toBeNull();
  });
});
