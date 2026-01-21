import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('rules module', () => {
  const tempDir = path.join(os.tmpdir(), 'inboxd-rules-test');
  const originalTokenDir = process.env.INBOXD_TOKEN_DIR;
  let addRule;
  let listRules;
  let removeRule;
  let readRules;
  let getRulesPath;
  let buildSuggestedRules;

  beforeEach(async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });

    vi.resetModules();
    process.env.INBOXD_TOKEN_DIR = tempDir;

    const module = await import('../src/rules');
    addRule = module.addRule;
    listRules = module.listRules;
    removeRule = module.removeRule;
    readRules = module.readRules;
    getRulesPath = module.getRulesPath;
    buildSuggestedRules = module.buildSuggestedRules;
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalTokenDir === undefined) {
      delete process.env.INBOXD_TOKEN_DIR;
    } else {
      process.env.INBOXD_TOKEN_DIR = originalTokenDir;
    }
  });

  it('uses INBOXD_TOKEN_DIR for rules path', () => {
    expect(getRulesPath()).toBe(path.join(tempDir, 'rules.json'));
  });

  it('adds a rule and avoids duplicates', () => {
    const first = addRule({ action: 'always-delete', sender: 'example.com' });
    const second = addRule({ action: 'always-delete', sender: 'example.com' });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(listRules()).toHaveLength(1);
  });

  it('removes a rule by id', () => {
    const { rule } = addRule({ action: 'never-delete', sender: 'news@example.com' });
    const result = removeRule(rule.id);

    expect(result.removed).toBe(true);
    expect(listRules()).toHaveLength(0);
  });

  it('builds suggestions from deletion analysis', () => {
    const analysis = {
      period: 30,
      totalDeleted: 10,
      frequentDeleters: [{ domain: 'spam.com', deletedCount: 4 }],
      neverReadSenders: [{ domain: 'promo.com', deletedCount: 3 }],
    };

    const suggestions = buildSuggestedRules(analysis);

    expect(suggestions.suggestions).toHaveLength(2);
    expect(suggestions.suggestions[0]).toHaveProperty('action');
    expect(suggestions.suggestions[0]).toHaveProperty('sender');
  });

  it('persists rules to disk', () => {
    addRule({ action: 'auto-archive', sender: 'github.com' });
    const data = readRules();

    expect(Array.isArray(data.rules)).toBe(true);
    expect(data.rules).toHaveLength(1);
  });

  it('supports auto-mark-read action', () => {
    const { rule, created } = addRule({ action: 'auto-mark-read', sender: 'notifications@github.com' });

    expect(created).toBe(true);
    expect(rule.action).toBe('auto-mark-read');
    expect(rule.sender).toBe('notifications@github.com');
    expect(listRules()).toHaveLength(1);
  });
});
