import { describe, it, expect, vi } from 'vitest';

// Test unarchive command logic
// Tests the gmail-monitor unarchiveEmails and CLI command logic

describe('Unarchive Command', () => {
  describe('unarchiveEmails API logic', () => {
    // Simulates the unarchiveEmails function in gmail-monitor.js
    async function unarchiveEmails(mockGmail, messageIds) {
      const results = [];

      for (const id of messageIds) {
        try {
          await mockGmail.users.messages.modify({
            userId: 'me',
            id: id,
            requestBody: {
              addLabelIds: ['INBOX'],
            },
          });
          results.push({ id, success: true });
        } catch (err) {
          results.push({ id, success: false, error: err.message });
        }
      }

      return results;
    }

    it('should add INBOX label to unarchive emails', async () => {
      const modifyCalls = [];
      const mockGmail = {
        users: {
          messages: {
            modify: vi.fn().mockImplementation((params) => {
              modifyCalls.push(params);
              return Promise.resolve({ data: { id: params.id } });
            }),
          },
        },
      };

      await unarchiveEmails(mockGmail, ['msg1', 'msg2']);

      expect(modifyCalls).toHaveLength(2);
      expect(modifyCalls[0].requestBody.addLabelIds).toContain('INBOX');
      expect(modifyCalls[1].requestBody.addLabelIds).toContain('INBOX');
    });

    it('should return success for each email', async () => {
      const mockGmail = {
        users: {
          messages: {
            modify: vi.fn().mockResolvedValue({ data: {} }),
          },
        },
      };

      const results = await unarchiveEmails(mockGmail, ['msg1', 'msg2']);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ id: 'msg1', success: true });
      expect(results[1]).toEqual({ id: 'msg2', success: true });
    });

    it('should handle API errors gracefully', async () => {
      const mockGmail = {
        users: {
          messages: {
            modify: vi.fn()
              .mockResolvedValueOnce({ data: {} })
              .mockRejectedValueOnce(new Error('Not found'))
              .mockResolvedValueOnce({ data: {} }),
          },
        },
      };

      const results = await unarchiveEmails(mockGmail, ['msg1', 'msg2', 'msg3']);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Not found');
      expect(results[2].success).toBe(true);
    });

    it('should handle empty message list', async () => {
      const mockGmail = {
        users: {
          messages: {
            modify: vi.fn(),
          },
        },
      };

      const results = await unarchiveEmails(mockGmail, []);

      expect(results).toHaveLength(0);
      expect(mockGmail.users.messages.modify).not.toHaveBeenCalled();
    });
  });

  describe('Command option parsing', () => {
    it('should parse --ids option into array', () => {
      const idsString = 'id1,id2,id3';
      const ids = idsString.split(',').map(id => id.trim()).filter(Boolean);

      expect(ids).toEqual(['id1', 'id2', 'id3']);
    });

    it('should handle whitespace in --ids', () => {
      const idsString = 'id1, id2 , id3';
      const ids = idsString.split(',').map(id => id.trim()).filter(Boolean);

      expect(ids).toEqual(['id1', 'id2', 'id3']);
    });

    it('should filter empty strings from --ids', () => {
      const idsString = 'id1,,id2,';
      const ids = idsString.split(',').map(id => id.trim()).filter(Boolean);

      expect(ids).toEqual(['id1', 'id2']);
    });

    it('should parse --last option as integer', () => {
      const lastValue = '5';
      const count = parseInt(lastValue, 10);

      expect(count).toBe(5);
      expect(typeof count).toBe('number');
    });
  });

  describe('Archive log lookup', () => {
    it('should find email in archive log by id', () => {
      const archiveLog = [
        { id: 'msg1', account: 'personal', from: 'a@b.com', subject: 'Test 1' },
        { id: 'msg2', account: 'work', from: 'c@d.com', subject: 'Test 2' },
        { id: 'msg3', account: 'personal', from: 'e@f.com', subject: 'Test 3' },
      ];

      const idsToFind = ['msg1', 'msg3'];
      const found = idsToFind
        .map(id => archiveLog.find(e => e.id === id))
        .filter(Boolean);

      expect(found).toHaveLength(2);
      expect(found[0].id).toBe('msg1');
      expect(found[1].id).toBe('msg3');
    });

    it('should return undefined for missing ids', () => {
      const archiveLog = [
        { id: 'msg1', account: 'personal' },
      ];

      const entry = archiveLog.find(e => e.id === 'nonexistent');
      expect(entry).toBeUndefined();
    });
  });

  describe('Grouping by account', () => {
    it('should group emails by account for batch operations', () => {
      const emailsToUnarchive = [
        { id: 'msg1', account: 'personal' },
        { id: 'msg2', account: 'work' },
        { id: 'msg3', account: 'personal' },
        { id: 'msg4', account: 'work' },
      ];

      const byAccount = {};
      for (const email of emailsToUnarchive) {
        if (!byAccount[email.account]) {
          byAccount[email.account] = [];
        }
        byAccount[email.account].push(email);
      }

      expect(Object.keys(byAccount)).toEqual(['personal', 'work']);
      expect(byAccount.personal).toHaveLength(2);
      expect(byAccount.work).toHaveLength(2);
    });
  });

  describe('JSON output structure', () => {
    it('should have correct structure for success', () => {
      const jsonOutput = {
        unarchived: 3,
        failed: 1,
        results: [
          { id: 'msg1', account: 'personal', from: 'a@b.com', subject: 'Test', success: true },
          { id: 'msg2', account: 'work', from: 'c@d.com', subject: 'Test 2', success: false },
        ],
      };

      expect(jsonOutput).toHaveProperty('unarchived');
      expect(jsonOutput).toHaveProperty('failed');
      expect(jsonOutput).toHaveProperty('results');
      expect(Array.isArray(jsonOutput.results)).toBe(true);
      expect(jsonOutput.results[0]).toHaveProperty('success');
    });

    it('should have correct structure for error', () => {
      const jsonOutput = {
        error: 'Must specify either --ids or --last',
      };

      expect(jsonOutput).toHaveProperty('error');
    });
  });

  describe('Result counting', () => {
    it('should count successful and failed operations', () => {
      const results = [
        { id: 'msg1', success: true },
        { id: 'msg2', success: true },
        { id: 'msg3', success: false },
        { id: 'msg4', success: true },
      ];

      const successfulIds = results.filter(r => r.success).map(r => r.id);
      const failedCount = results.filter(r => !r.success).length;

      expect(successfulIds).toEqual(['msg1', 'msg2', 'msg4']);
      expect(failedCount).toBe(1);
    });
  });
});
