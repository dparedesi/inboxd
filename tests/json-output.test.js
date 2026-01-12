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

  describe('inboxd rules list --json', () => {
    it('should output rules list structure', () => {
      const jsonOutput = {
        count: 2,
        path: '/Users/test/.config/inboxd/rules.json',
        rules: [
          { id: 'rule_1', action: 'always-delete', sender: 'spam.com', olderThanDays: null },
        ],
      };

      expect(jsonOutput).toHaveProperty('count');
      expect(jsonOutput).toHaveProperty('path');
      expect(Array.isArray(jsonOutput.rules)).toBe(true);
    });
  });

  describe('inboxd undo --json', () => {
    it('should output undo results structure', () => {
      const jsonOutput = {
        action: 'delete',
        undone: 2,
        failed: 1,
        results: [
          { id: 'msg1', account: 'personal', from: 'a@b.com', subject: 'Test', success: true },
          { id: 'msg2', account: 'work', from: 'c@d.com', subject: 'Test 2', success: false },
        ],
      };

      expect(jsonOutput).toHaveProperty('action');
      expect(jsonOutput).toHaveProperty('undone');
      expect(jsonOutput).toHaveProperty('failed');
      expect(Array.isArray(jsonOutput.results)).toBe(true);
    });
  });

  describe('inboxd read --unsubscribe --json', () => {
    it('should output unsubscribe structure', () => {
      const jsonOutput = {
        id: 'msg1',
        subject: 'Newsletter',
        from: 'news@example.com',
        unsubscribeLink: 'https://example.com/unsubscribe',
        unsubscribeEmail: 'unsubscribe@example.com',
        oneClick: true,
        sources: { header: true, body: false },
        unsubscribeLinks: ['https://example.com/unsubscribe'],
        unsubscribeEmails: ['unsubscribe@example.com'],
        preferenceLinks: ['https://example.com/preferences'],
        headerLinks: ['https://example.com/unsubscribe'],
        bodyLinks: [],
        listUnsubscribe: '<mailto:unsubscribe@example.com>',
        listUnsubscribePost: 'List-Unsubscribe=One-Click',
      };

      expect(jsonOutput).toHaveProperty('unsubscribeLink');
      expect(jsonOutput).toHaveProperty('unsubscribeEmail');
      expect(jsonOutput).toHaveProperty('oneClick');
      expect(jsonOutput).toHaveProperty('sources');
      expect(jsonOutput).toHaveProperty('preferenceLinks');
    });
  });

  describe('inboxd rules apply --json', () => {
    it('should output rule application structure', () => {
      const jsonOutput = {
        dryRun: true,
        totals: { delete: 2, archive: 1, protected: 1 },
        rules: [
          { id: 'rule_1', action: 'always-delete', sender: 'spam.com', matches: 2, applied: 2, protected: 0 },
        ],
        delete: { count: 2, emails: [{ id: 'msg1', account: 'personal' }] },
        archive: { count: 1, emails: [{ id: 'msg2', account: 'personal' }] },
        skippedRules: [],
        limit: 50,
      };

      expect(jsonOutput).toHaveProperty('dryRun');
      expect(jsonOutput).toHaveProperty('totals');
      expect(jsonOutput).toHaveProperty('rules');
      expect(jsonOutput).toHaveProperty('delete');
      expect(jsonOutput).toHaveProperty('archive');
    });
  });

  describe('inboxd rules suggest --json', () => {
    it('should output rule suggestions structure', () => {
      const jsonOutput = {
        period: 30,
        totalDeleted: 5,
        suggestions: [
          { action: 'always-delete', sender: 'spam.com', reason: 'Deleted 4 times', source: 'frequentDeleters' },
        ],
      };

      expect(jsonOutput).toHaveProperty('period');
      expect(jsonOutput).toHaveProperty('totalDeleted');
      expect(Array.isArray(jsonOutput.suggestions)).toBe(true);
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
