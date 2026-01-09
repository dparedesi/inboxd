import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Usage Log', () => {
  const originalTokenDir = process.env.INBOXD_TOKEN_DIR;
  const originalNoAnalytics = process.env.INBOXD_NO_ANALYTICS;
  let tempDir = null;
  let usageLog = null;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inboxd-usage-log-'));
    vi.resetModules();
    process.env.INBOXD_TOKEN_DIR = tempDir;
    delete process.env.INBOXD_NO_ANALYTICS;
    usageLog = await import('../src/usage-log');
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (originalTokenDir === undefined) {
      delete process.env.INBOXD_TOKEN_DIR;
    } else {
      process.env.INBOXD_TOKEN_DIR = originalTokenDir;
    }
    if (originalNoAnalytics === undefined) {
      delete process.env.INBOXD_NO_ANALYTICS;
    } else {
      process.env.INBOXD_NO_ANALYTICS = originalNoAnalytics;
    }
  });

  it('appends usage entries to JSONL', () => {
    const { logUsage, getUsagePath } = usageLog;
    logUsage({ cmd: 'delete', flags: ['--dry-run'], success: true });

    const logPath = getUsagePath();
    const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.cmd).toBe('delete');
    expect(entry.flags).toEqual(['--dry-run']);
    expect(entry.success).toBe(true);
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry).toHaveProperty('account');
  });

  it('aggregates usage by command', () => {
    const { logUsage, getUsagePath, getUsageStats } = usageLog;
    // Call logUsage once to ensure directory is created
    logUsage({ cmd: 'setup', flags: [], success: true });

    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ cmd: 'summary', flags: ['--json'], ts: now, success: true, account: null }),
      JSON.stringify({ cmd: 'summary', flags: [], ts: now, success: true, account: null }),
      JSON.stringify({ cmd: 'delete', flags: ['--dry-run'], ts: now, success: false, account: null }),
    ];

    fs.writeFileSync(getUsagePath(), lines.join('\n') + '\n');
    const stats = getUsageStats(30);

    expect(stats.byCommand.summary).toBe(2);
    expect(stats.byCommand.delete).toBe(1);
    expect(stats.total).toBe(3);
    expect(stats.failure).toBe(1);
  });

  it('rotates when over 10,000 entries', () => {
    const { logUsage, getUsagePath } = usageLog;
    // Call logUsage once to ensure directory is created
    logUsage({ cmd: 'setup', flags: [], success: true });

    const logPath = getUsagePath();
    const entry = JSON.stringify({
      cmd: 'summary',
      flags: [],
      ts: new Date().toISOString(),
      success: true,
      account: null,
    });

    const lines = Array.from({ length: 10001 }, () => entry).join('\n') + '\n';
    fs.writeFileSync(logPath, lines);
    logUsage({ cmd: 'summary', flags: [], success: true });

    const updated = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
    expect(updated.length).toBeLessThanOrEqual(10000);
  });

  it('respects INBOXD_NO_ANALYTICS opt-out', () => {
    const { logUsage, getUsagePath, isEnabled } = usageLog;
    const logPath = getUsagePath();

    // Remove any existing file first
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
    }

    // Now set the opt-out flag
    process.env.INBOXD_NO_ANALYTICS = '1';

    // isEnabled should now return false
    expect(isEnabled()).toBe(false);

    // logUsage should not create the file
    logUsage({ cmd: 'summary', flags: [], success: true });

    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('ignores malformed lines when parsing stats', () => {
    const { logUsage, getUsagePath, getUsageStats } = usageLog;
    // Call logUsage once to ensure directory is created
    logUsage({ cmd: 'setup', flags: [], success: true });

    const now = new Date().toISOString();
    const lines = [
      'not-json',
      JSON.stringify({ cmd: 'summary', flags: [], ts: now, success: true, account: null }),
    ];

    fs.writeFileSync(getUsagePath(), lines.join('\n') + '\n');
    const stats = getUsageStats(30);

    // Should have 1 valid entry (ignores the malformed line)
    expect(stats.total).toBe(1);
    expect(stats.byCommand.summary).toBe(1);
  });
});
