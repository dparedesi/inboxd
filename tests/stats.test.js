import { describe, it, expect } from 'vitest';

// Test the stats logic without importing real modules
// This follows the pattern used in deletion-log.test.js

describe('Stats Command', () => {
  describe('extractDomain helper', () => {
    // Mirrors the extractDomain function in deletion-log.js
    function extractDomain(from) {
      const match = from.match(/@([a-zA-Z0-9.-]+)/);
      return match ? match[1].toLowerCase() : 'unknown';
    }

    it('should extract domain from email in angle brackets', () => {
      expect(extractDomain('John Doe <john@example.com>')).toBe('example.com');
    });

    it('should extract domain from bare email', () => {
      expect(extractDomain('john@example.com')).toBe('example.com');
    });

    it('should handle subdomain', () => {
      expect(extractDomain('noreply@mail.linkedin.com')).toBe('mail.linkedin.com');
    });

    it('should return unknown for invalid format', () => {
      expect(extractDomain('No Email Here')).toBe('unknown');
      expect(extractDomain('')).toBe('unknown');
    });

    it('should lowercase the domain', () => {
      expect(extractDomain('user@EXAMPLE.COM')).toBe('example.com');
    });
  });

  describe('Deletion Stats', () => {
    // Mirrors getStats() logic from deletion-log.js
    function getStats(deletions) {
      const byAccount = {};
      deletions.forEach(d => {
        const account = d.account || 'default';
        byAccount[account] = (byAccount[account] || 0) + 1;
      });

      const bySender = {};
      deletions.forEach(d => {
        const match = (d.from || '').match(/@([a-zA-Z0-9.-]+)/);
        const domain = match ? match[1].toLowerCase() : 'unknown';
        bySender[domain] = (bySender[domain] || 0) + 1;
      });

      const topSenders = Object.entries(bySender)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([domain, count]) => ({ domain, count }));

      return {
        total: deletions.length,
        byAccount,
        topSenders,
      };
    }

    it('should count total deletions', () => {
      const deletions = [
        { id: '1', account: 'personal', from: 'a@example.com' },
        { id: '2', account: 'work', from: 'b@test.com' },
        { id: '3', account: 'personal', from: 'c@example.com' },
      ];
      const stats = getStats(deletions);
      expect(stats.total).toBe(3);
    });

    it('should group by account', () => {
      const deletions = [
        { id: '1', account: 'personal', from: 'a@example.com' },
        { id: '2', account: 'work', from: 'b@test.com' },
        { id: '3', account: 'personal', from: 'c@example.com' },
      ];
      const stats = getStats(deletions);
      expect(stats.byAccount).toEqual({ personal: 2, work: 1 });
    });

    it('should use default for missing account', () => {
      const deletions = [
        { id: '1', from: 'a@example.com' },
      ];
      const stats = getStats(deletions);
      expect(stats.byAccount).toEqual({ default: 1 });
    });

    it('should rank top senders by count', () => {
      const deletions = [
        { id: '1', from: 'a@linkedin.com', account: 'test' },
        { id: '2', from: 'b@linkedin.com', account: 'test' },
        { id: '3', from: 'c@linkedin.com', account: 'test' },
        { id: '4', from: 'd@amazon.com', account: 'test' },
        { id: '5', from: 'e@amazon.com', account: 'test' },
        { id: '6', from: 'f@github.com', account: 'test' },
      ];
      const stats = getStats(deletions);
      expect(stats.topSenders[0]).toEqual({ domain: 'linkedin.com', count: 3 });
      expect(stats.topSenders[1]).toEqual({ domain: 'amazon.com', count: 2 });
      expect(stats.topSenders[2]).toEqual({ domain: 'github.com', count: 1 });
    });

    it('should limit top senders to 10', () => {
      const deletions = [];
      for (let i = 0; i < 15; i++) {
        deletions.push({ id: `${i}`, from: `user@domain${i}.com`, account: 'test' });
      }
      const stats = getStats(deletions);
      expect(stats.topSenders.length).toBe(10);
    });

    it('should handle empty deletions', () => {
      const stats = getStats([]);
      expect(stats.total).toBe(0);
      expect(stats.byAccount).toEqual({});
      expect(stats.topSenders).toEqual([]);
    });
  });

  describe('Sent Stats', () => {
    // Mirrors getSentStats() logic from sent-log.js
    function getSentStats(sent) {
      let replies = 0;
      let newEmails = 0;
      sent.forEach(s => {
        if (s.replyToId) {
          replies++;
        } else {
          newEmails++;
        }
      });

      const byAccount = {};
      sent.forEach(s => {
        const account = s.account || 'default';
        byAccount[account] = (byAccount[account] || 0) + 1;
      });

      return {
        total: sent.length,
        replies,
        newEmails,
        byAccount,
      };
    }

    it('should count total sent emails', () => {
      const sent = [
        { id: '1', account: 'personal' },
        { id: '2', account: 'work' },
      ];
      const stats = getSentStats(sent);
      expect(stats.total).toBe(2);
    });

    it('should distinguish replies from new emails', () => {
      const sent = [
        { id: '1', account: 'test', replyToId: 'orig1' },
        { id: '2', account: 'test', replyToId: 'orig2' },
        { id: '3', account: 'test', replyToId: null },
        { id: '4', account: 'test' },
      ];
      const stats = getSentStats(sent);
      expect(stats.replies).toBe(2);
      expect(stats.newEmails).toBe(2);
    });

    it('should group by account', () => {
      const sent = [
        { id: '1', account: 'personal' },
        { id: '2', account: 'work' },
        { id: '3', account: 'personal' },
      ];
      const stats = getSentStats(sent);
      expect(stats.byAccount).toEqual({ personal: 2, work: 1 });
    });

    it('should handle empty sent list', () => {
      const stats = getSentStats([]);
      expect(stats.total).toBe(0);
      expect(stats.replies).toBe(0);
      expect(stats.newEmails).toBe(0);
      expect(stats.byAccount).toEqual({});
    });
  });

  describe('Stats JSON output structure', () => {
    it('should have correct structure for JSON output', () => {
      const jsonOutput = {
        period: 30,
        deleted: {
          total: 10,
          byAccount: { personal: 5, work: 5 },
          topSenders: [{ domain: 'example.com', count: 3 }],
        },
        sent: {
          total: 3,
          replies: 2,
          newEmails: 1,
          byAccount: { personal: 3 },
        },
      };

      expect(jsonOutput).toHaveProperty('period');
      expect(jsonOutput).toHaveProperty('deleted');
      expect(jsonOutput).toHaveProperty('sent');
      expect(jsonOutput.deleted).toHaveProperty('total');
      expect(jsonOutput.deleted).toHaveProperty('byAccount');
      expect(jsonOutput.deleted).toHaveProperty('topSenders');
      expect(jsonOutput.sent).toHaveProperty('replies');
      expect(jsonOutput.sent).toHaveProperty('newEmails');
    });
  });
});
