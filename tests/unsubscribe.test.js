import { describe, it, expect } from 'vitest';

const {
  parseListUnsubscribe,
  findUnsubscribeLinksInBody,
  extractUnsubscribeInfo,
} = require('../src/gmail-monitor');

describe('unsubscribe parsing', () => {
  it('parses List-Unsubscribe header with mailto and link', () => {
    const header = '<mailto:unsub@example.com?subject=unsubscribe>, <https://example.com/unsub>';
    const result = parseListUnsubscribe(header);

    expect(result.mailtos).toEqual(['mailto:unsub@example.com?subject=unsubscribe']);
    expect(result.links).toEqual(['https://example.com/unsub']);
  });

  it('finds unsubscribe links in body', () => {
    const body = 'Click https://example.com/unsubscribe?id=123 to stop emails.';
    const links = findUnsubscribeLinksInBody(body, 'text/plain');

    expect(links.unsubscribeLinks).toHaveLength(1);
    expect(links.unsubscribeLinks[0]).toContain('unsubscribe');
  });

  it('finds preference links in body by link text', () => {
    const html = '<a href="https://example.com/preferences">Manage Preferences</a>';
    const links = findUnsubscribeLinksInBody(html, 'text/html');

    expect(links.preferenceLinks).toHaveLength(1);
    expect(links.preferenceLinks[0]).toContain('preferences');
  });

  it('extracts unsubscribe info from headers and body', () => {
    const headers = [
      { name: 'List-Unsubscribe', value: '<mailto:bye@example.com>, <https://example.com/unsub>' },
      { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
    ];
    const body = 'Manage: https://example.com/unsubscribe/manage';

    const info = extractUnsubscribeInfo(headers, body, 'text/plain');

    expect(info.unsubscribeLinks).toContain('https://example.com/unsub');
    expect(info.unsubscribeEmails).toContain('bye@example.com');
    expect(info.oneClick).toBe(true);
    expect(info.sources.header).toBe(true);
  });
});
