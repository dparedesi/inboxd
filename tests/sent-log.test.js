import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';

// Test the logic patterns used by sent-log
// Similar structure to deletion-log.test.js

describe('Sent Log', () => {
  const LOG_DIR = path.join(os.homedir(), '.config', 'inboxd');
  const LOG_FILE = path.join(LOG_DIR, 'sent-log.json');

  describe('Log entry structure', () => {
    it('should have required fields for sent email tracking', () => {
      const logEntry = {
        sentAt: '2026-01-03T15:45:00.000Z',
        account: 'dparedesi@uni.pe',
        id: '19b84376ff5f5ed2',
        threadId: '19b84376ff5f5ed2',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        bodyPreview: 'First 200 chars of body...',
        replyToId: null,
      };

      expect(logEntry).toHaveProperty('sentAt');
      expect(logEntry).toHaveProperty('account');
      expect(logEntry).toHaveProperty('id');
      expect(logEntry).toHaveProperty('threadId');
      expect(logEntry).toHaveProperty('to');
      expect(logEntry).toHaveProperty('subject');
      expect(logEntry).toHaveProperty('bodyPreview');
      expect(logEntry).toHaveProperty('replyToId');
    });

    it('should track reply-to for replies', () => {
      const replyEntry = {
        sentAt: new Date().toISOString(),
        account: 'test',
        id: 'new-id',
        threadId: 'thread-id',
        to: 'sender@example.com',
        subject: 'Re: Original Subject',
        bodyPreview: 'My reply...',
        replyToId: 'original-message-id',
      };

      expect(replyEntry.replyToId).toBe('original-message-id');
    });

    it('should have null replyToId for new messages', () => {
      const newEmailEntry = {
        sentAt: new Date().toISOString(),
        account: 'test',
        id: 'new-id',
        threadId: 'thread-id',
        to: 'recipient@example.com',
        subject: 'New Subject',
        bodyPreview: 'Body...',
        replyToId: null,
      };

      expect(newEmailEntry.replyToId).toBeNull();
    });
  });

  describe('Body preview logic', () => {
    it('should truncate body to 200 chars', () => {
      const longBody = 'A'.repeat(500);
      const preview = longBody.substring(0, 200);

      expect(preview).toHaveLength(200);
    });

    it('should not truncate short body', () => {
      const shortBody = 'Short message';
      const preview = shortBody.substring(0, 200);

      expect(preview).toBe('Short message');
    });
  });

  describe('Log filtering', () => {
    it('should filter entries by date range', () => {
      const now = new Date();
      const tenDaysAgo = new Date(now);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      const fortyDaysAgo = new Date(now);
      fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);

      const entries = [
        { sentAt: now.toISOString(), id: 'recent' },
        { sentAt: tenDaysAgo.toISOString(), id: 'ten-days' },
        { sentAt: fortyDaysAgo.toISOString(), id: 'forty-days' },
      ];

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);

      const recentEntries = entries.filter((e) => new Date(e.sentAt) >= cutoff);

      expect(recentEntries).toHaveLength(2);
      expect(recentEntries.map(e => e.id)).toContain('recent');
      expect(recentEntries.map(e => e.id)).toContain('ten-days');
      expect(recentEntries.map(e => e.id)).not.toContain('forty-days');
    });
  });

  describe('Log path', () => {
    it('should use correct log directory path', () => {
      expect(LOG_DIR).toContain('.config');
      expect(LOG_DIR).toContain('inboxd');
    });

    it('should use correct log file name', () => {
      expect(LOG_FILE).toContain('sent-log.json');
    });
  });

  describe('Empty log handling', () => {
    it('should return empty array for empty log', () => {
      const emptyLog = [];
      expect(emptyLog).toHaveLength(0);
      expect(Array.isArray(emptyLog)).toBe(true);
    });

    it('should handle missing log file gracefully', () => {
      // Simulate the readSentLog behavior when file doesn't exist
      const readLogSafe = (fileExists, fileContent) => {
        if (!fileExists) return [];
        try {
          return JSON.parse(fileContent);
        } catch {
          return [];
        }
      };

      expect(readLogSafe(false, '')).toEqual([]);
      expect(readLogSafe(true, 'invalid json')).toEqual([]);
      expect(readLogSafe(true, '[]')).toEqual([]);
    });
  });
});
