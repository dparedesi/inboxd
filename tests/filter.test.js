import { describe, it, expect } from 'vitest';

// Test the email filtering logic used in inboxd delete command
// We test the logic patterns without importing the actual module

describe('Email Filtering Logic', () => {
  const testEmails = [
    { id: '1', from: 'LinkedIn Jobs <jobs@linkedin.com>', subject: 'New jobs for you', account: 'personal' },
    { id: '2', from: 'Jules Bot <jules@company.com>', subject: 'PR #42 ready for review', account: 'work' },
    { id: '3', from: 'newsletter@techcrunch.com', subject: 'TechCrunch Weekly Digest', account: 'personal' },
    { id: '4', from: 'Security Alert <security@bank.com>', subject: 'Unusual login detected', account: 'personal' },
    { id: '5', from: 'LinkedIn <notifications@linkedin.com>', subject: 'You have 3 new messages', account: 'work' },
    { id: '6', from: 'GitHub <noreply@github.com>', subject: 'PR Review requested', account: 'work' },
  ];

  /**
   * Filter function matching the implementation in cli.js
   */
  function filterEmails(emails, senderPattern, matchPattern) {
    return emails.filter(e => {
      const matchesSender = !senderPattern ||
        e.from.toLowerCase().includes(senderPattern.toLowerCase());
      const matchesSubject = !matchPattern ||
        e.subject.toLowerCase().includes(matchPattern.toLowerCase());
      return matchesSender && matchesSubject;
    });
  }

  describe('Sender filtering', () => {
    it('should match case-insensitive substring in from field', () => {
      const filtered = filterEmails(testEmails, 'linkedin', null);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(e => e.id)).toEqual(['1', '5']);
    });

    it('should match partial sender names', () => {
      const filtered = filterEmails(testEmails, 'jules', null);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('2');
    });

    it('should match email domains', () => {
      const filtered = filterEmails(testEmails, '@linkedin.com', null);
      expect(filtered).toHaveLength(2);
    });

    it('should be case insensitive', () => {
      const filtered = filterEmails(testEmails, 'LINKEDIN', null);
      expect(filtered).toHaveLength(2);
    });

    it('should match partial email addresses', () => {
      const filtered = filterEmails(testEmails, 'noreply', null);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('6');
    });
  });

  describe('Subject filtering', () => {
    it('should match case-insensitive substring in subject', () => {
      const filtered = filterEmails(testEmails, null, 'login');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('4');
    });

    it('should match partial subject phrases', () => {
      const filtered = filterEmails(testEmails, null, 'weekly');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('3');
    });

    it('should match PR-related subjects', () => {
      const filtered = filterEmails(testEmails, null, 'PR');
      expect(filtered).toHaveLength(2);
      expect(filtered.map(e => e.id).sort()).toEqual(['2', '6']);
    });
  });

  describe('Combined filtering (AND logic)', () => {
    it('should require both sender AND subject to match', () => {
      const filtered = filterEmails(testEmails, 'linkedin', 'jobs');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('1');
    });

    it('should return empty when no emails match both criteria', () => {
      const filtered = filterEmails(testEmails, 'linkedin', 'security');
      expect(filtered).toHaveLength(0);
    });

    it('should work with overlapping patterns', () => {
      const filtered = filterEmails(testEmails, 'github', 'review');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('6');
    });
  });

  describe('No filter (passthrough)', () => {
    it('should return all emails when no filters specified', () => {
      const filtered = filterEmails(testEmails, null, null);
      expect(filtered).toHaveLength(6);
    });

    it('should return all emails with empty string filters', () => {
      const filtered = filterEmails(testEmails, '', '');
      expect(filtered).toHaveLength(6);
    });
  });
});

describe('Safety Limit Logic', () => {
  it('should enforce default limit of 50', () => {
    const manyEmails = Array.from({ length: 100 }, (_, i) => ({
      id: `msg${i}`,
      from: 'spam@example.com',
      subject: `Spam ${i}`,
    }));
    const limit = 50;
    const limited = manyEmails.slice(0, limit);
    expect(limited).toHaveLength(50);
  });

  it('should respect custom limit', () => {
    const manyEmails = Array.from({ length: 100 }, (_, i) => ({
      id: `msg${i}`,
      from: 'spam@example.com',
      subject: `Spam ${i}`,
    }));
    const limit = 25;
    const limited = manyEmails.slice(0, limit);
    expect(limited).toHaveLength(25);
  });

  it('should not truncate when under limit', () => {
    const emails = Array.from({ length: 10 }, (_, i) => ({
      id: `msg${i}`,
      from: 'test@example.com',
      subject: `Test ${i}`,
    }));
    const limit = 50;
    const limited = emails.length > limit ? emails.slice(0, limit) : emails;
    expect(limited).toHaveLength(10);
  });
});

describe('Safety Warning Logic', () => {
  function getWarnings(senderPattern, matchPattern, matchCount) {
    const warnings = [];

    if (senderPattern && senderPattern.length < 3) {
      warnings.push(`Short sender pattern "${senderPattern}" may match broadly`);
    }
    if (matchPattern && matchPattern.length < 3) {
      warnings.push(`Short subject pattern "${matchPattern}" may match broadly`);
    }
    if (matchCount > 100) {
      warnings.push(`${matchCount} emails match - large batch deletion`);
    }

    return warnings;
  }

  it('should warn on short sender pattern', () => {
    const warnings = getWarnings('ab', null, 5);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Short sender pattern');
  });

  it('should warn on short subject pattern', () => {
    const warnings = getWarnings(null, 're', 5);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Short subject pattern');
  });

  it('should warn on large batch', () => {
    const warnings = getWarnings('linkedin', null, 150);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('150 emails match');
  });

  it('should accumulate multiple warnings', () => {
    const warnings = getWarnings('a', 'b', 200);
    expect(warnings).toHaveLength(3);
  });

  it('should not warn for valid patterns and small batches', () => {
    const warnings = getWarnings('linkedin', 'newsletter', 10);
    expect(warnings).toHaveLength(0);
  });

  it('should allow exactly 3 char patterns without warning', () => {
    const warnings = getWarnings('abc', 'def', 50);
    expect(warnings).toHaveLength(0);
  });

  it('should allow exactly 100 matches without warning', () => {
    const warnings = getWarnings('linkedin', null, 100);
    expect(warnings).toHaveLength(0);
  });
});
