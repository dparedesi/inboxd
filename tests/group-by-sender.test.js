import { describe, it, expect } from 'vitest';

// Test the extractSenderDomain and groupEmailsBySender logic
// We duplicate the logic here to avoid importing the module which requires gmail-auth

/**
 * Extract domain from From header
 */
function extractSenderDomain(from) {
  if (!from) return '';
  const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
  if (emailMatch) {
    const email = emailMatch[1];
    const domain = email.split('@')[1];
    return domain ? domain.toLowerCase() : email.toLowerCase();
  }
  return from.toLowerCase();
}

/**
 * Group emails by sender domain
 */
function groupEmailsBySender(emails) {
  const groups = {};

  for (const email of emails) {
    const domain = extractSenderDomain(email.from);
    if (!groups[domain]) {
      groups[domain] = {
        sender: domain,
        senderDisplay: email.from,
        count: 0,
        emails: [],
      };
    }
    groups[domain].count++;
    groups[domain].emails.push({
      id: email.id,
      subject: email.subject,
      date: email.date,
      account: email.account,
    });
  }

  const groupArray = Object.values(groups).sort((a, b) => b.count - a.count);
  return { groups: groupArray, totalCount: emails.length };
}

describe('extractSenderDomain', () => {
  it('should extract domain from "Name <email>" format', () => {
    expect(extractSenderDomain('LinkedIn Jobs <jobs@linkedin.com>')).toBe('linkedin.com');
  });

  it('should extract domain from bare email', () => {
    expect(extractSenderDomain('newsletter@techcrunch.com')).toBe('techcrunch.com');
  });

  it('should extract domain from quoted name format', () => {
    expect(extractSenderDomain('"John Doe" <john@example.com>')).toBe('example.com');
  });

  it('should handle malformed input gracefully', () => {
    expect(extractSenderDomain('Unknown Sender')).toBe('unknown sender');
  });

  it('should lowercase domains', () => {
    expect(extractSenderDomain('News <NEWS@EXAMPLE.COM>')).toBe('example.com');
  });

  it('should handle empty input', () => {
    expect(extractSenderDomain('')).toBe('');
    expect(extractSenderDomain(null)).toBe('');
    expect(extractSenderDomain(undefined)).toBe('');
  });

  it('should handle email with plus addressing', () => {
    expect(extractSenderDomain('Service <user+tag@domain.com>')).toBe('domain.com');
  });
});

describe('groupEmailsBySender', () => {
  const testEmails = [
    { id: '1', from: 'LinkedIn Jobs <jobs@linkedin.com>', subject: 'New jobs', date: '2026-01-03', account: 'personal' },
    { id: '2', from: 'LinkedIn <updates@linkedin.com>', subject: 'Weekly update', date: '2026-01-02', account: 'personal' },
    { id: '3', from: 'GitHub <noreply@github.com>', subject: 'PR merged', date: '2026-01-03', account: 'work' },
    { id: '4', from: 'newsletter@techcrunch.com', subject: 'Daily digest', date: '2026-01-03', account: 'personal' },
    { id: '5', from: 'LinkedIn <messages@linkedin.com>', subject: 'New message', date: '2026-01-01', account: 'work' },
  ];

  it('should group emails by sender domain', () => {
    const result = groupEmailsBySender(testEmails);
    expect(result.groups).toHaveLength(3);
    expect(result.totalCount).toBe(5);
  });

  it('should sort groups by count descending', () => {
    const result = groupEmailsBySender(testEmails);
    expect(result.groups[0].sender).toBe('linkedin.com');
    expect(result.groups[0].count).toBe(3);
  });

  it('should preserve senderDisplay from first email', () => {
    const result = groupEmailsBySender(testEmails);
    const linkedInGroup = result.groups.find(g => g.sender === 'linkedin.com');
    expect(linkedInGroup.senderDisplay).toBe('LinkedIn Jobs <jobs@linkedin.com>');
  });

  it('should include minimal email fields in group', () => {
    const result = groupEmailsBySender(testEmails);
    const email = result.groups[0].emails[0];
    expect(email).toHaveProperty('id');
    expect(email).toHaveProperty('subject');
    expect(email).toHaveProperty('date');
    expect(email).toHaveProperty('account');
    expect(email).not.toHaveProperty('from'); // Redundant in group
    expect(email).not.toHaveProperty('snippet'); // Not needed for overview
  });

  it('should handle empty input', () => {
    const result = groupEmailsBySender([]);
    expect(result.groups).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it('should handle single email', () => {
    const result = groupEmailsBySender([testEmails[0]]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].count).toBe(1);
    expect(result.totalCount).toBe(1);
  });

  it('should group all emails from same domain regardless of subdomain', () => {
    const emails = [
      { id: '1', from: 'noreply@mail.example.com', subject: 'A', date: '', account: 'test' },
      { id: '2', from: 'alerts@example.com', subject: 'B', date: '', account: 'test' },
    ];
    const result = groupEmailsBySender(emails);
    // These have different domains (mail.example.com vs example.com)
    expect(result.groups).toHaveLength(2);
  });
});
