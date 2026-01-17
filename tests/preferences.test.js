import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('preferences module', () => {
  const tempDir = path.join(os.tmpdir(), 'inboxd-preferences-test');
  const originalTokenDir = process.env.INBOXD_TOKEN_DIR;
  let getPreferencesPath;
  let preferencesExist;
  let readPreferences;
  let writePreferences;
  let validatePreferences;
  let appendToSection;
  let resolveSection;
  let setEntry;
  let removeFromSection;
  let getEntriesInSection;

  beforeEach(async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });

    vi.resetModules();
    process.env.INBOXD_TOKEN_DIR = tempDir;

    const module = await import('../src/preferences');
    getPreferencesPath = module.getPreferencesPath;
    preferencesExist = module.preferencesExist;
    readPreferences = module.readPreferences;
    writePreferences = module.writePreferences;
    validatePreferences = module.validatePreferences;
    appendToSection = module.appendToSection;
    resolveSection = module.resolveSection;
    setEntry = module.setEntry;
    removeFromSection = module.removeFromSection;
    getEntriesInSection = module.getEntriesInSection;
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalTokenDir === undefined) {
      delete process.env.INBOXD_TOKEN_DIR;
    } else {
      process.env.INBOXD_TOKEN_DIR = originalTokenDir;
    }
  });

  it('uses INBOXD_TOKEN_DIR for preference path', () => {
    expect(getPreferencesPath()).toBe(path.join(tempDir, 'user-preferences.md'));
  });

  it('writes preferences and creates a backup on overwrite', () => {
    const initial = '# Inbox Preferences\nInitial content\n';
    writePreferences(initial);
    expect(preferencesExist()).toBe(true);

    const updated = '# Inbox Preferences\nUpdated content\n';
    writePreferences(updated);

    const backupPath = `${getPreferencesPath()}.backup`;
    expect(fs.existsSync(backupPath)).toBe(true);
    const backupContent = fs.readFileSync(backupPath, 'utf8');
    expect(backupContent).toContain('Initial content');

    const current = readPreferences();
    expect(current).toContain('Updated content');
  });

  it('flags files over 500 lines', () => {
    const oversized = '# Inbox Preferences\n' + 'line\n'.repeat(501);
    const result = validatePreferences(oversized);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('500'))).toBe(true);
  });

  it('appends to existing sections using the template when missing', () => {
    const result = appendToSection('Important People (Never Auto-Delete)', 'test@example.com - never delete');
    const content = readPreferences();

    expect(result.createdSection).toBe(false);
    expect(content).toContain('## Important People');
    expect(content).toContain('test@example.com');
  });

  it('resolves section aliases to canonical names', () => {
    expect(resolveSection('sender')).toBe('Sender Behaviors');
    expect(resolveSection('important')).toBe('Important People (Never Auto-Delete)');
    expect(resolveSection('category')).toBe('Category Rules');
    expect(resolveSection('behavior')).toBe('Behavioral Preferences');
    expect(resolveSection('about')).toBe('About Me');
    expect(resolveSection('## Sender Behaviors')).toBe('Sender Behaviors');
  });

  it('lists entries in a section', () => {
    writePreferences([
      '# Inbox Preferences',
      '',
      '## Sender Behaviors',
      '<!-- comment -->',
      '- IBKR holidays - always delete',
      '- GitHub notifications - summarize',
      '',
      '## Category Rules',
      '- Newsletters - summarize',
      '',
    ].join('\n'));

    const entries = getEntriesInSection('sender');
    expect(entries).toEqual([
      'IBKR holidays - always delete',
      'GitHub notifications - summarize',
    ]);
  });

  it('sets entries idempotently and removes entries by match', () => {
    const first = setEntry('sender', 'IBKR holidays - always delete');
    const second = setEntry('Sender Behaviors', 'IBKR holidays - always delete');
    const entries = getEntriesInSection('sender');

    expect(first.added).toBe(true);
    expect(second.existed).toBe(true);
    expect(entries.filter(entry => entry === 'IBKR holidays - always delete')).toHaveLength(1);

    const removal = removeFromSection('sender', { match: 'ibkr' });
    expect(removal.removed).toBe(true);
    expect(removal.count).toBe(1);
    expect(removal.entries).toEqual(['IBKR holidays - always delete']);
    expect(readPreferences()).not.toContain('IBKR holidays - always delete');
  });

  it('removes entries by exact entry', () => {
    writePreferences([
      '# Inbox Preferences',
      '',
      '## Category Rules',
      '- Newsletters - summarize',
      '',
    ].join('\n'));

    const removal = removeFromSection('category', { entry: 'Newsletters - summarize' });
    expect(removal.removed).toBe(true);
    expect(removal.count).toBe(1);
    expect(readPreferences()).not.toContain('Newsletters - summarize');
  });
});
