import { describe, it, expect } from 'vitest';

const { buildRuleQuery, emailMatchesRule, buildActionPlan } = require('../src/rules-engine');

describe('rules engine', () => {
  it('builds Gmail query with older-than and quoted sender', () => {
    const rule = { sender: 'News Letter', olderThanDays: 30 };
    const query = buildRuleQuery(rule);
    expect(query).toBe('from:"News Letter" older_than:30d');
  });

  it('matches emails by sender and older-than', () => {
    const olderDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const rule = { sender: 'example.com', olderThanDays: 30 };

    expect(emailMatchesRule({ from: 'alerts@example.com', date: olderDate }, rule)).toBe(true);
    expect(emailMatchesRule({ from: 'alerts@example.com', date: recentDate }, rule)).toBe(false);
  });

  it('applies precedence: never-delete protects from delete/archive', () => {
    const ruleMatches = [
      {
        rule: { id: 'r1', action: 'never-delete', sender: 'vip.com' },
        emails: [
          { id: '1', account: 'a', from: 'boss@vip.com' },
        ],
      },
      {
        rule: { id: 'r2', action: 'always-delete', sender: 'vip.com' },
        emails: [
          { id: '1', account: 'a', from: 'boss@vip.com' },
        ],
      },
      {
        rule: { id: 'r3', action: 'auto-archive', sender: 'news.com' },
        emails: [
          { id: '2', account: 'a', from: 'news@news.com' },
        ],
      },
    ];

    const plan = buildActionPlan(ruleMatches);
    expect(plan.deleteCandidates).toHaveLength(0);
    expect(plan.archiveCandidates).toHaveLength(1);
    expect(plan.ruleSummaries.find(rule => rule.id === 'r1').protected).toBe(1);
  });
});
