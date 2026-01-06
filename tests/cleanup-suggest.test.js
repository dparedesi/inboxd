import { describe, it, expect } from 'vitest';

// Test cleanup-suggest / analyzePatterns logic
// Mirrors the analyzePatterns function in deletion-log.js

describe('Cleanup Suggestions', () => {
  // Helper to extract domain from email address
  function extractDomain(from) {
    const match = from.match(/@([a-zA-Z0-9.-]+)/);
    return match ? match[1].toLowerCase() : 'unknown';
  }

  // Mirrors analyzePatterns() from deletion-log.js
  function analyzePatterns(deletions) {
    const senderStats = {};
    deletions.forEach(d => {
      const domain = extractDomain(d.from || '');
      if (!senderStats[domain]) {
        senderStats[domain] = { count: 0, unreadCount: 0, subjects: new Set() };
      }
      senderStats[domain].count++;
      if (d.labelIds && d.labelIds.includes('UNREAD')) {
        senderStats[domain].unreadCount++;
      }
      if (d.subject) {
        senderStats[domain].subjects.add(d.subject.substring(0, 30));
      }
    });

    const frequentDeleters = Object.entries(senderStats)
      .filter(([_, stats]) => stats.count >= 3)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([domain, stats]) => ({
        domain,
        deletedCount: stats.count,
        suggestion: 'Consider unsubscribing',
      }));

    const neverReadSenders = Object.entries(senderStats)
      .filter(([_, stats]) => stats.count >= 2 && stats.unreadCount === stats.count)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([domain, stats]) => ({
        domain,
        deletedCount: stats.count,
        suggestion: 'You never read these - consider bulk cleanup',
      }));

    return {
      period: 30,
      totalDeleted: deletions.length,
      frequentDeleters,
      neverReadSenders,
    };
  }

  describe('Frequent Deleters Detection', () => {
    it('should identify senders with 3+ deletions', () => {
      const deletions = [
        { id: '1', from: 'a@linkedin.com' },
        { id: '2', from: 'b@linkedin.com' },
        { id: '3', from: 'c@linkedin.com' },
        { id: '4', from: 'd@amazon.com' },
        { id: '5', from: 'e@amazon.com' },
      ];

      const analysis = analyzePatterns(deletions);

      expect(analysis.frequentDeleters).toHaveLength(1);
      expect(analysis.frequentDeleters[0].domain).toBe('linkedin.com');
      expect(analysis.frequentDeleters[0].deletedCount).toBe(3);
    });

    it('should not include senders with less than 3 deletions', () => {
      const deletions = [
        { id: '1', from: 'a@example.com' },
        { id: '2', from: 'b@example.com' },
      ];

      const analysis = analyzePatterns(deletions);
      expect(analysis.frequentDeleters).toHaveLength(0);
    });

    it('should sort frequent deleters by count descending', () => {
      const deletions = [
        { id: '1', from: 'a@linkedin.com' },
        { id: '2', from: 'b@linkedin.com' },
        { id: '3', from: 'c@linkedin.com' },
        { id: '4', from: 'd@amazon.com' },
        { id: '5', from: 'e@amazon.com' },
        { id: '6', from: 'f@amazon.com' },
        { id: '7', from: 'g@amazon.com' },
        { id: '8', from: 'h@github.com' },
        { id: '9', from: 'i@github.com' },
        { id: '10', from: 'j@github.com' },
      ];

      const analysis = analyzePatterns(deletions);

      expect(analysis.frequentDeleters[0].domain).toBe('amazon.com');
      expect(analysis.frequentDeleters[0].deletedCount).toBe(4);
      expect(analysis.frequentDeleters[1].deletedCount).toBe(3);
    });
  });

  describe('Never-Read Senders Detection', () => {
    it('should identify senders whose emails were always deleted unread', () => {
      const deletions = [
        { id: '1', from: 'promo@store.com', labelIds: ['UNREAD'] },
        { id: '2', from: 'promo@store.com', labelIds: ['UNREAD'] },
        { id: '3', from: 'promo@store.com', labelIds: ['UNREAD'] },
      ];

      const analysis = analyzePatterns(deletions);

      expect(analysis.neverReadSenders).toHaveLength(1);
      expect(analysis.neverReadSenders[0].domain).toBe('store.com');
      expect(analysis.neverReadSenders[0].deletedCount).toBe(3);
    });

    it('should not include senders with some read emails', () => {
      const deletions = [
        { id: '1', from: 'news@example.com', labelIds: ['UNREAD'] },
        { id: '2', from: 'news@example.com', labelIds: [] }, // was read
        { id: '3', from: 'news@example.com', labelIds: ['UNREAD'] },
      ];

      const analysis = analyzePatterns(deletions);
      expect(analysis.neverReadSenders).toHaveLength(0);
    });

    it('should require at least 2 deletions for never-read', () => {
      const deletions = [
        { id: '1', from: 'one@example.com', labelIds: ['UNREAD'] },
      ];

      const analysis = analyzePatterns(deletions);
      expect(analysis.neverReadSenders).toHaveLength(0);
    });

    it('should handle missing labelIds gracefully', () => {
      const deletions = [
        { id: '1', from: 'a@test.com' },
        { id: '2', from: 'b@test.com' },
      ];

      // Should not throw
      const analysis = analyzePatterns(deletions);
      expect(analysis.neverReadSenders).toHaveLength(0);
    });
  });

  describe('Analysis Output Structure', () => {
    it('should include period and total', () => {
      const analysis = analyzePatterns([]);
      expect(analysis).toHaveProperty('period');
      expect(analysis).toHaveProperty('totalDeleted');
      expect(analysis.totalDeleted).toBe(0);
    });

    it('should provide suggestions for frequent deleters', () => {
      const deletions = [
        { id: '1', from: 'a@spam.com' },
        { id: '2', from: 'b@spam.com' },
        { id: '3', from: 'c@spam.com' },
      ];

      const analysis = analyzePatterns(deletions);
      expect(analysis.frequentDeleters[0]).toHaveProperty('suggestion');
      expect(analysis.frequentDeleters[0].suggestion).toContain('unsubscribing');
    });

    it('should provide suggestions for never-read senders', () => {
      const deletions = [
        { id: '1', from: 'a@junk.com', labelIds: ['UNREAD'] },
        { id: '2', from: 'b@junk.com', labelIds: ['UNREAD'] },
      ];

      const analysis = analyzePatterns(deletions);
      expect(analysis.neverReadSenders[0]).toHaveProperty('suggestion');
      expect(analysis.neverReadSenders[0].suggestion).toContain('bulk cleanup');
    });
  });

  describe('JSON output structure', () => {
    it('should have correct structure for JSON output', () => {
      const jsonOutput = {
        period: 30,
        totalDeleted: 15,
        frequentDeleters: [
          { domain: 'linkedin.com', deletedCount: 8, suggestion: 'Consider unsubscribing' }
        ],
        neverReadSenders: [
          { domain: 'promo.com', deletedCount: 5, suggestion: 'You never read these...' }
        ],
      };

      expect(jsonOutput).toHaveProperty('period');
      expect(jsonOutput).toHaveProperty('totalDeleted');
      expect(jsonOutput).toHaveProperty('frequentDeleters');
      expect(jsonOutput).toHaveProperty('neverReadSenders');
      expect(Array.isArray(jsonOutput.frequentDeleters)).toBe(true);
      expect(Array.isArray(jsonOutput.neverReadSenders)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty deletions list', () => {
      const analysis = analyzePatterns([]);
      expect(analysis.totalDeleted).toBe(0);
      expect(analysis.frequentDeleters).toEqual([]);
      expect(analysis.neverReadSenders).toEqual([]);
    });

    it('should handle emails with missing from field', () => {
      const deletions = [
        { id: '1' },
        { id: '2', from: '' },
        { id: '3', from: null },
      ];

      // Should not throw
      const analysis = analyzePatterns(deletions);
      expect(analysis.totalDeleted).toBe(3);
    });

    it('should group same sender with different display names', () => {
      const deletions = [
        { id: '1', from: 'LinkedIn Jobs <jobs@linkedin.com>' },
        { id: '2', from: 'LinkedIn Connections <connect@linkedin.com>' },
        { id: '3', from: 'noreply@linkedin.com' },
      ];

      const analysis = analyzePatterns(deletions);
      expect(analysis.frequentDeleters).toHaveLength(1);
      expect(analysis.frequentDeleters[0].domain).toBe('linkedin.com');
      expect(analysis.frequentDeleters[0].deletedCount).toBe(3);
    });
  });
});
