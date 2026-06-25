import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { claudeProjectsDir, codexSessionsDir } from '../src/collector/paths.js';

describe('claudeProjectsDir', () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  });

  it('defaults to ~/.claude/projects', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    expect(claudeProjectsDir()).toBe(join(homedir(), '.claude', 'projects'));
  });

  it('honors CLAUDE_CONFIG_DIR (the same override Claude Code respects)', () => {
    process.env.CLAUDE_CONFIG_DIR = '/tmp/fake-claude';
    expect(claudeProjectsDir()).toBe(join('/tmp/fake-claude', 'projects'));
  });

  it('ignores a blank CLAUDE_CONFIG_DIR', () => {
    process.env.CLAUDE_CONFIG_DIR = '   ';
    expect(claudeProjectsDir()).toBe(join(homedir(), '.claude', 'projects'));
  });
});

describe('codexSessionsDir', () => {
  const prev = process.env.CODEX_HOME;
  afterEach(() => {
    if (prev === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prev;
  });

  it('defaults to ~/.codex/sessions', () => {
    delete process.env.CODEX_HOME;
    expect(codexSessionsDir()).toBe(join(homedir(), '.codex', 'sessions'));
  });

  it('honors CODEX_HOME', () => {
    process.env.CODEX_HOME = '/tmp/fake-codex';
    expect(codexSessionsDir()).toBe(join('/tmp/fake-codex', 'sessions'));
  });
});
