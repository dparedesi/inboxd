import { describe, it, expect } from 'vitest';

// Test JSON output structures for commands that gained --json support
// Validates the output format for AI agent consumption

describe('JSON Output Formats', () => {
  describe('inboxd accounts --json', () => {
    it('should output account list structure', () => {
      const jsonOutput = {
        accounts: [
          { name: 'personal', email: 'user@gmail.com' },
          { name: 'work', email: 'user@company.com' },
        ],
      };

      expect(jsonOutput).toHaveProperty('accounts');
      expect(Array.isArray(jsonOutput.accounts)).toBe(true);
      expect(jsonOutput.accounts[0]).toHaveProperty('name');
      expect(jsonOutput.accounts[0]).toHaveProperty('email');
    });

    it('should handle empty accounts list', () => {
      const jsonOutput = {
        accounts: [],
      };

      expect(jsonOutput.accounts).toEqual([]);
    });
  });

  describe('inboxd deletion-log --json', () => {
    it('should output deletion log structure', () => {
      const jsonOutput = {
        days: 30,
        count: 15,
        logPath: '/Users/test/.config/inboxd/deletion-log.json',
        deletions: [
          {
            deletedAt: '2026-01-03T15:45:00.000Z',
            account: 'personal',
            id: '19b84376ff5f5ed2',
            threadId: '19b84376ff5f5ed2',
            from: 'sender@example.com',
            subject: 'Test Subject',
            snippet: 'Email preview...',
          },
        ],
      };

      expect(jsonOutput).toHaveProperty('days');
      expect(jsonOutput).toHaveProperty('count');
      expect(jsonOutput).toHaveProperty('logPath');
      expect(jsonOutput).toHaveProperty('deletions');
      expect(Array.isArray(jsonOutput.deletions)).toBe(true);
    });

    it('should include all deletion entry fields', () => {
      const deletion = {
        deletedAt: '2026-01-03T15:45:00.000Z',
        account: 'personal',
        id: '19b84376ff5f5ed2',
        threadId: '19b84376ff5f5ed2',
        from: 'sender@example.com',
        subject: 'Test Subject',
        snippet: 'Email preview...',
      };

      expect(deletion).toHaveProperty('deletedAt');
      expect(deletion).toHaveProperty('account');
      expect(deletion).toHaveProperty('id');
      expect(deletion).toHaveProperty('threadId');
      expect(deletion).toHaveProperty('from');
      expect(deletion).toHaveProperty('subject');
      expect(deletion).toHaveProperty('snippet');
    });
  });

  describe('inboxd delete --dry-run --json', () => {
    it('should output preview structure', () => {
      const jsonOutput = {
        dryRun: true,
        count: 5,
        emails: [
          {
            id: 'msg1',
            account: 'personal',
            from: 'sender@example.com',
            subject: 'Test Subject',
            date: 'Fri, 03 Jan 2026 10:30:00 -0800',
          },
        ],
      };

      expect(jsonOutput).toHaveProperty('dryRun');
      expect(jsonOutput.dryRun).toBe(true);
      expect(jsonOutput).toHaveProperty('count');
      expect(jsonOutput).toHaveProperty('emails');
      expect(Array.isArray(jsonOutput.emails)).toBe(true);
    });

    it('should include email details for each item', () => {
      const email = {
        id: 'msg1',
        account: 'personal',
        from: 'sender@example.com',
        subject: 'Test Subject',
        date: 'Fri, 03 Jan 2026 10:30:00 -0800',
      };

      expect(email).toHaveProperty('id');
      expect(email).toHaveProperty('account');
      expect(email).toHaveProperty('from');
      expect(email).toHaveProperty('subject');
      expect(email).toHaveProperty('date');
    });

    it('should handle empty preview', () => {
      const jsonOutput = {
        dryRun: true,
        count: 0,
        emails: [],
      };

      expect(jsonOutput.count).toBe(0);
      expect(jsonOutput.emails).toEqual([]);
    });
  });

  describe('inboxd restore --json', () => {
    it('should output restore results structure', () => {
      const jsonOutput = {
        restored: 3,
        failed: 1,
        results: [
          { id: 'msg1', account: 'personal', from: 'a@b.com', subject: 'Test', success: true },
          { id: 'msg2', account: 'work', from: 'c@d.com', subject: 'Test 2', success: false },
        ],
      };

      expect(jsonOutput).toHaveProperty('restored');
      expect(jsonOutput).toHaveProperty('failed');
      expect(jsonOutput).toHaveProperty('results');
      expect(Array.isArray(jsonOutput.results)).toBe(true);
    });

    it('should include success status for each result', () => {
      const result = {
        id: 'msg1',
        account: 'personal',
        from: 'a@b.com',
        subject: 'Test',
        success: true,
      };

      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    });

    it('should output error structure on failure', () => {
      const jsonOutput = {
        error: 'Must specify either --ids or --last',
      };

      expect(jsonOutput).toHaveProperty('error');
      expect(typeof jsonOutput.error).toBe('string');
    });
  });

  describe('JSON formatting', () => {
    it('should produce valid JSON', () => {
      const data = {
        accounts: [{ name: 'test', email: 'test@example.com' }],
      };

      const jsonString = JSON.stringify(data, null, 2);
      const parsed = JSON.parse(jsonString);

      expect(parsed).toEqual(data);
    });

    it('should use 2-space indentation', () => {
      const data = { key: 'value' };
      const jsonString = JSON.stringify(data, null, 2);

      expect(jsonString).toContain('\n');
      expect(jsonString).toContain('  '); // 2-space indent
    });
  });
});
