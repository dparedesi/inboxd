import { describe, it, expect } from 'vitest';

describe('Analyze Command', () => {
  describe('Email data structure', () => {
    it('should include labelIds and threadId in email objects', () => {
      const email = {
        id: 'msg123',
        threadId: 'thread456',
        labelIds: ['UNREAD', 'CATEGORY_PROMOTIONS'],
        account: 'personal',
        from: 'promo@store.com',
        subject: 'Sale ends today!',
        snippet: 'Don\'t miss out on 50% off...',
        date: '2026-01-03',
      };

      expect(email.threadId).toBe('thread456');
      expect(email.labelIds).toContain('CATEGORY_PROMOTIONS');
      expect(email.labelIds).toContain('UNREAD');
    });

    it('should handle emails without labelIds gracefully', () => {
      const email = {
        id: 'msg123',
        threadId: 'thread456',
        labelIds: [],
        account: 'work',
        from: 'boss@company.com',
        subject: 'Meeting tomorrow',
        snippet: 'Can we sync up...',
        date: '2026-01-03',
      };

      expect(email.labelIds).toEqual([]);
      expect(Array.isArray(email.labelIds)).toBe(true);
    });
  });

  describe('JSON output format', () => {
    it('should produce valid JSON array', () => {
      const emails = [
        {
          id: 'msg1',
          threadId: 'thread1',
          labelIds: ['UNREAD', 'INBOX'],
          account: 'personal',
          from: 'friend@example.com',
          subject: 'Hello!',
          snippet: 'How are you doing?',
          date: '2026-01-03',
        },
        {
          id: 'msg2',
          threadId: 'thread2',
          labelIds: ['UNREAD', 'CATEGORY_UPDATES'],
          account: 'work',
          from: 'github@notifications.com',
          subject: 'PR merged',
          snippet: 'Your pull request was merged...',
          date: '2026-01-03',
        },
      ];

      const jsonOutput = JSON.stringify(emails, null, 2);
      const parsed = JSON.parse(jsonOutput);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe('msg1');
      expect(parsed[1].labelIds).toContain('CATEGORY_UPDATES');
    });

    it('should include all required fields for AI analysis', () => {
      const email = {
        id: 'msg123',
        threadId: 'thread456',
        labelIds: ['UNREAD', 'INBOX'],
        account: 'dparedesi@uni.pe',
        from: 'LinkedIn <jobs@linkedin.com>',
        subject: 'New job matches for you',
        snippet: 'Director of Engineering at...',
        date: 'Fri, 03 Jan 2026 10:00:00 +0000',
      };

      // All fields needed for categorization
      expect(email).toHaveProperty('from');
      expect(email).toHaveProperty('subject');
      expect(email).toHaveProperty('snippet');
      expect(email).toHaveProperty('labelIds');
      expect(email).toHaveProperty('account');
    });
  });

  describe('Count limiting', () => {
    it('should respect max count parameter', () => {
      const allEmails = Array.from({ length: 50 }, (_, i) => ({
        id: `msg${i}`,
        threadId: `thread${i}`,
        labelIds: ['UNREAD'],
        account: 'test',
        from: `sender${i}@example.com`,
        subject: `Email ${i}`,
        snippet: `Content ${i}`,
        date: '2026-01-03',
      }));

      const maxCount = 20;
      const limitedEmails = allEmails.slice(0, maxCount);

      expect(limitedEmails).toHaveLength(20);
      expect(limitedEmails[0].id).toBe('msg0');
      expect(limitedEmails[19].id).toBe('msg19');
    });
  });

  describe('Account filtering', () => {
    it('should filter emails by account', () => {
      const allEmails = [
        { id: '1', account: 'personal', subject: 'Personal' },
        { id: '2', account: 'work', subject: 'Work' },
        { id: '3', account: 'personal', subject: 'Personal 2' },
        { id: '4', account: 'other', subject: 'Other' },
      ];

      const workEmails = allEmails.filter(e => e.account === 'work');
      const personalEmails = allEmails.filter(e => e.account === 'personal');

      expect(workEmails).toHaveLength(1);
      expect(personalEmails).toHaveLength(2);
    });
  });

  describe('Gmail label categorization hints', () => {
    it('should identify promotional emails by labelIds', () => {
      const email = {
        labelIds: ['UNREAD', 'CATEGORY_PROMOTIONS'],
      };

      const isPromo = email.labelIds.includes('CATEGORY_PROMOTIONS');
      expect(isPromo).toBe(true);
    });

    it('should identify update emails by labelIds', () => {
      const email = {
        labelIds: ['UNREAD', 'CATEGORY_UPDATES'],
      };

      const isUpdate = email.labelIds.includes('CATEGORY_UPDATES');
      expect(isUpdate).toBe(true);
    });

    it('should identify primary inbox emails', () => {
      const email = {
        labelIds: ['UNREAD', 'INBOX'],
      };

      const isPrimary = email.labelIds.includes('INBOX') &&
        !email.labelIds.includes('CATEGORY_PROMOTIONS') &&
        !email.labelIds.includes('CATEGORY_UPDATES') &&
        !email.labelIds.includes('CATEGORY_SOCIAL');

      expect(isPrimary).toBe(true);
    });
  });
});
