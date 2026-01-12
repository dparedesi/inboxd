import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('undo-log module', () => {
  const tempDir = path.join(os.tmpdir(), 'inboxd-undo-log-test');
  const originalTokenDir = process.env.INBOXD_TOKEN_DIR;
  let logUndoAction;
  let getRecentUndoActions;
  let removeUndoEntry;
  let updateUndoEntry;
  let getUndoLogPath;

  beforeEach(async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });

    vi.resetModules();
    process.env.INBOXD_TOKEN_DIR = tempDir;

    const module = await import('../src/undo-log');
    logUndoAction = module.logUndoAction;
    getRecentUndoActions = module.getRecentUndoActions;
    removeUndoEntry = module.removeUndoEntry;
    updateUndoEntry = module.updateUndoEntry;
    getUndoLogPath = module.getUndoLogPath;
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalTokenDir === undefined) {
      delete process.env.INBOXD_TOKEN_DIR;
    } else {
      process.env.INBOXD_TOKEN_DIR = originalTokenDir;
    }
  });

  it('uses INBOXD_TOKEN_DIR for undo log path', () => {
    expect(getUndoLogPath()).toBe(path.join(tempDir, 'undo-log.json'));
  });

  it('logs undo actions with items', () => {
    const entry = logUndoAction('delete', [
      { id: '1', account: 'personal', from: 'a@b.com', subject: 'Test', threadId: 't1' },
    ]);

    expect(entry).toHaveProperty('id');
    expect(entry.count).toBe(1);
    const recent = getRecentUndoActions(1);
    expect(recent).toHaveLength(1);
  });

  it('updates undo entries', () => {
    const entry = logUndoAction('archive', [
      { id: '1', account: 'work', from: 'a@b.com', subject: 'A', threadId: 't1' },
      { id: '2', account: 'work', from: 'c@d.com', subject: 'B', threadId: 't2' },
    ]);

    const updated = updateUndoEntry(entry.id, {
      items: [{ id: '2', account: 'work', from: 'c@d.com', subject: 'B', threadId: 't2' }],
    });

    expect(updated.count).toBe(1);
    expect(updated.items).toHaveLength(1);
  });

  it('removes undo entries', () => {
    const entry = logUndoAction('delete', [
      { id: '1', account: 'personal', from: 'a@b.com', subject: 'Test', threadId: 't1' },
    ]);

    const removed = removeUndoEntry(entry.id);
    expect(removed).toBe(true);
    expect(getRecentUndoActions(10)).toHaveLength(0);
  });
});
