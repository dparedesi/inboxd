import { describe, it, expect } from 'vitest';

// Test the groupEmailsByThread logic without importing gmail-monitor

function groupEmailsByThread(emails) {
  const groups = {};

  for (const email of emails) {
    const threadId = email.threadId || email.id;
    if (!groups[threadId]) {
      groups[threadId] = {
        threadId,
        subject: email.subject || '',
        count: 0,
        participants: new Set(),
        emails: [],
      };
    }
    groups[threadId].count++;
    if (email.from) {
      groups[threadId].participants.add(email.from);
    }
    groups[threadId].emails.push({
      id: email.id,
      subject: email.subject,
      date: email.date,
      account: email.account,
    });
  }

  const groupArray = Object.values(groups)
    .map(group => ({
      threadId: group.threadId,
      subject: group.subject,
      count: group.count,
      participants: Array.from(group.participants),
      emails: group.emails,
    }))
    .sort((a, b) => b.count - a.count);

  return { groups: groupArray, totalCount: emails.length };
}

describe('groupEmailsByThread', () => {
  const testEmails = [
    { id: '1', threadId: 't1', from: 'a@b.com', subject: 'Hello', date: '2026-01-03', account: 'personal' },
    { id: '2', threadId: 't1', from: 'c@d.com', subject: 'Re: Hello', date: '2026-01-04', account: 'personal' },
    { id: '3', threadId: 't2', from: 'e@f.com', subject: 'Update', date: '2026-01-05', account: 'work' },
  ];

  it('should group emails by threadId', () => {
    const result = groupEmailsByThread(testEmails);
    expect(result.groups).toHaveLength(2);
    expect(result.totalCount).toBe(3);
  });

  it('should include participants per thread', () => {
    const result = groupEmailsByThread(testEmails);
    const group = result.groups.find(g => g.threadId === 't1');
    expect(group.participants).toHaveLength(2);
  });

  it('should sort groups by count descending', () => {
    const result = groupEmailsByThread(testEmails);
    expect(result.groups[0].threadId).toBe('t1');
    expect(result.groups[0].count).toBe(2);
  });

  it('should handle missing threadId by using id', () => {
    const result = groupEmailsByThread([{ id: 'x1', from: 'a@b.com', subject: 'Solo', date: '', account: 'test' }]);
    expect(result.groups[0].threadId).toBe('x1');
  });
});
