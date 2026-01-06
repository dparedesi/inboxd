import { describe, it, expect } from 'vitest';

const { extractLinks, isValidUrl, decodeHtmlEntities, extractBody } = require('../src/gmail-monitor');

describe('Link Extraction', () => {

  describe('isValidUrl', () => {
    it('should accept http URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
    });

    it('should accept https URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path?query=1')).toBe(true);
    });

    it('should reject javascript: URLs', () => {
      expect(isValidUrl('javascript:void(0)')).toBe(false);
      expect(isValidUrl('javascript:alert("hi")')).toBe(false);
    });

    it('should reject data: URLs', () => {
      expect(isValidUrl('data:text/html,<h1>Hello</h1>')).toBe(false);
    });

    it('should reject mailto: URLs', () => {
      expect(isValidUrl('mailto:test@example.com')).toBe(false);
    });

    it('should reject tel: URLs', () => {
      expect(isValidUrl('tel:+1234567890')).toBe(false);
    });

    it('should reject file: URLs', () => {
      expect(isValidUrl('file:///etc/passwd')).toBe(false);
    });

    it('should handle null/undefined/empty', () => {
      expect(isValidUrl(null)).toBe(false);
      expect(isValidUrl(undefined)).toBe(false);
      expect(isValidUrl('')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(isValidUrl('HTTP://EXAMPLE.COM')).toBe(true);
      expect(isValidUrl('HTTPS://EXAMPLE.COM')).toBe(true);
      expect(isValidUrl('JAVASCRIPT:void(0)')).toBe(false);
    });
  });

  describe('decodeHtmlEntities', () => {
    it('should decode &amp;', () => {
      expect(decodeHtmlEntities('a&amp;b')).toBe('a&b');
    });

    it('should decode &lt; and &gt;', () => {
      expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>');
    });

    it('should decode &quot;', () => {
      expect(decodeHtmlEntities('&quot;hello&quot;')).toBe('"hello"');
    });

    it('should decode &#39;', () => {
      expect(decodeHtmlEntities('it&#39;s')).toBe("it's");
    });

    it('should handle empty/null', () => {
      expect(decodeHtmlEntities('')).toBe('');
      expect(decodeHtmlEntities(null)).toBe('');
      expect(decodeHtmlEntities(undefined)).toBe('');
    });

    it('should decode multiple entities', () => {
      expect(decodeHtmlEntities('a&amp;b&lt;c')).toBe('a&b<c');
    });
  });

  describe('extractLinks from HTML', () => {
    it('should extract href from anchor tags', () => {
      const html = '<a href="https://example.com">Click here</a>';
      const links = extractLinks(html, 'text/html');
      expect(links).toHaveLength(1);
      expect(links[0].url).toBe('https://example.com');
      expect(links[0].text).toBe('Click here');
    });

    it('should extract multiple links', () => {
      const html = `
        <a href="https://example.com/1">Link 1</a>
        <a href="https://example.com/2">Link 2</a>
      `;
      const links = extractLinks(html, 'text/html');
      expect(links).toHaveLength(2);
      expect(links[0].url).toBe('https://example.com/1');
      expect(links[1].url).toBe('https://example.com/2');
    });

    it('should deduplicate URLs', () => {
      const html = `
        <a href="https://example.com">First</a>
        <a href="https://example.com">Second</a>
      `;
      const links = extractLinks(html, 'text/html');
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe('First'); // First occurrence wins
    });

    it('should filter out javascript: URLs', () => {
      const html = `
        <a href="javascript:alert('hi')">JS</a>
        <a href="https://real.com">Real</a>
      `;
      const links = extractLinks(html, 'text/html');
      expect(links).toHaveLength(1);
      expect(links[0].url).toBe('https://real.com');
    });

    it('should filter out mailto: URLs', () => {
      const html = `
        <a href="mailto:test@example.com">Email</a>
        <a href="https://real.com">Real</a>
      `;
      const links = extractLinks(html, 'text/html');
      expect(links).toHaveLength(1);
      expect(links[0].url).toBe('https://real.com');
    });

    it('should decode HTML entities in URLs', () => {
      const html = '<a href="https://example.com?a=1&amp;b=2">Link</a>';
      const links = extractLinks(html, 'text/html');
      expect(links).toHaveLength(1);
      expect(links[0].url).toBe('https://example.com?a=1&b=2');
    });

    it('should handle links with extra attributes', () => {
      const html = '<a class="btn" href="https://example.com" target="_blank">Link</a>';
      const links = extractLinks(html, 'text/html');
      expect(links).toHaveLength(1);
      expect(links[0].url).toBe('https://example.com');
    });

    it('should also extract plain URLs not in anchor tags', () => {
      const html = '<p>Visit https://plain-url.com for more info</p>';
      const links = extractLinks(html, 'text/html');
      expect(links).toHaveLength(1);
      expect(links[0].url).toBe('https://plain-url.com');
      expect(links[0].text).toBe(null);
    });
  });

  describe('extractLinks from plain text', () => {
    it('should extract URLs from plain text', () => {
      const text = 'Check out https://example.com for more info';
      const links = extractLinks(text, 'text/plain');
      expect(links).toHaveLength(1);
      expect(links[0].url).toBe('https://example.com');
      expect(links[0].text).toBe(null);
    });

    it('should handle URLs with trailing punctuation', () => {
      const text = 'Visit https://example.com, or https://other.com.';
      const links = extractLinks(text, 'text/plain');
      expect(links).toHaveLength(2);
      expect(links[0].url).toBe('https://example.com');
      expect(links[1].url).toBe('https://other.com');
    });

    it('should handle URLs with query strings', () => {
      const text = 'Link: https://example.com/path?foo=bar&baz=qux';
      const links = extractLinks(text, 'text/plain');
      expect(links).toHaveLength(1);
      expect(links[0].url).toBe('https://example.com/path?foo=bar&baz=qux');
    });

    it('should handle multiple URLs on same line', () => {
      const text = 'See https://one.com and https://two.com';
      const links = extractLinks(text, 'text/plain');
      expect(links).toHaveLength(2);
    });

    it('should return empty array for no links', () => {
      const text = 'No links here, just plain text';
      const links = extractLinks(text, 'text/plain');
      expect(links).toHaveLength(0);
    });

    it('should handle empty body', () => {
      expect(extractLinks('', 'text/plain')).toHaveLength(0);
      expect(extractLinks(null, 'text/plain')).toHaveLength(0);
      expect(extractLinks(undefined, 'text/plain')).toHaveLength(0);
    });
  });

  describe('extractBody with preferHtml option', () => {
    it('should prefer text/plain by default', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/html',
            body: { data: Buffer.from('<b>HTML</b>').toString('base64url') }
          },
          {
            mimeType: 'text/plain',
            body: { data: Buffer.from('Plain text').toString('base64url') }
          }
        ]
      };
      const result = extractBody(payload);
      expect(result.content).toBe('Plain text');
      expect(result.type).toBe('text/plain');
    });

    it('should prefer text/html when preferHtml is true', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/html',
            body: { data: Buffer.from('<b>HTML</b>').toString('base64url') }
          },
          {
            mimeType: 'text/plain',
            body: { data: Buffer.from('Plain text').toString('base64url') }
          }
        ]
      };
      const result = extractBody(payload, { preferHtml: true });
      expect(result.content).toBe('<b>HTML</b>');
      expect(result.type).toBe('text/html');
    });

    it('should fallback to text/plain if no HTML available', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/plain',
            body: { data: Buffer.from('Plain text').toString('base64url') }
          }
        ]
      };
      const result = extractBody(payload, { preferHtml: true });
      expect(result.content).toBe('Plain text');
      expect(result.type).toBe('text/plain');
    });
  });
});
