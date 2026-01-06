import { describe, it, expect } from 'vitest';

// Import the actual exported helper functions for testing
// These are pure functions that don't require mocking
const { extractBody, decodeBase64Url, composeMessage } = require('../src/gmail-monitor');

describe('Gmail Monitor New Features', () => {

  describe('decodeBase64Url', () => {
    it('should decode base64url encoded string', () => {
      const encoded = Buffer.from('Hello world').toString('base64url');
      expect(decodeBase64Url(encoded)).toBe('Hello world');
    });

    it('should return empty string for empty input', () => {
      expect(decodeBase64Url('')).toBe('');
      expect(decodeBase64Url(null)).toBe('');
      expect(decodeBase64Url(undefined)).toBe('');
    });

    it('should handle unicode content', () => {
      const encoded = Buffer.from('Hello 世界 🌍').toString('base64url');
      expect(decodeBase64Url(encoded)).toBe('Hello 世界 🌍');
    });
  });

  describe('extractBody', () => {
    it('should extract body from simple text/plain payload', () => {
      const payload = {
        mimeType: 'text/plain',
        body: {
          data: Buffer.from('Hello world').toString('base64url')
        }
      };
      const result = extractBody(payload);
      expect(result.content).toBe('Hello world');
      expect(result.type).toBe('text/plain');
    });

    it('should prefer text/plain in multipart/alternative', () => {
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

    it('should fallback to text/html if no plain text', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/html',
            body: { data: Buffer.from('<b>HTML only</b>').toString('base64url') }
          }
        ]
      };
      const result = extractBody(payload);
      expect(result.content).toBe('<b>HTML only</b>');
      expect(result.type).toBe('text/html');
    });

    it('should handle nested multipart (multipart/mixed with multipart/alternative)', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              {
                mimeType: 'text/plain',
                body: { data: Buffer.from('Nested plain').toString('base64url') }
              }
            ]
          },
          {
            mimeType: 'application/pdf',
            filename: 'attachment.pdf',
            body: { attachmentId: 'xyz' }
          }
        ]
      };
      const result = extractBody(payload);
      expect(result.content).toBe('Nested plain');
      expect(result.type).toBe('text/plain');
    });

    it('should return empty content for payload with no body data', () => {
      const payload = {
        mimeType: 'text/plain'
        // no body
      };
      const result = extractBody(payload);
      expect(result.content).toBe('');
      expect(result.type).toBe('text/plain');
    });

    it('should handle parts without body data', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'text/plain'
            // no body data
          }
        ]
      };
      const result = extractBody(payload);
      expect(result.content).toBe('');
    });
  });

  describe('composeMessage', () => {
    it('should compose a simple email message', () => {
      const encoded = composeMessage({
        to: 'test@example.com',
        subject: 'Test Subject',
        body: 'Hello Body'
      });

      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');

      expect(decoded).toContain('To: test@example.com');
      expect(decoded).toContain('Subject: Test Subject');
      expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"');
      expect(decoded).toContain('MIME-Version: 1.0');
      expect(decoded).toContain('Hello Body');
    });

    it('should include In-Reply-To and References headers for replies', () => {
      const encoded = composeMessage({
        to: 'sender@example.com',
        subject: 'Re: Original Subject',
        body: 'My reply',
        inReplyTo: '<msg123@example.com>',
        references: '<ref1@example.com> <msg123@example.com>'
      });

      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');

      expect(decoded).toContain('In-Reply-To: <msg123@example.com>');
      expect(decoded).toContain('References: <ref1@example.com> <msg123@example.com>');
    });

    it('should not include reply headers when not provided', () => {
      const encoded = composeMessage({
        to: 'test@example.com',
        subject: 'New Email',
        body: 'Body'
      });

      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');

      expect(decoded).not.toContain('In-Reply-To:');
      expect(decoded).not.toContain('References:');
    });

    it('should handle special characters in subject and body', () => {
      const encoded = composeMessage({
        to: 'test@example.com',
        subject: 'Test: Special chars & symbols!',
        body: 'Line 1\nLine 2\n\nParagraph with émojis 🎉'
      });

      const decoded = Buffer.from(encoded, 'base64url').toString('utf8');

      expect(decoded).toContain('Subject: Test: Special chars & symbols!');
      expect(decoded).toContain('émojis 🎉');
    });
  });

  describe('Reply Subject Logic', () => {
    // Test the Re: prefix logic used in replyToEmail
    function buildReplySubject(originalSubject) {
      return originalSubject.toLowerCase().startsWith('re:')
        ? originalSubject
        : `Re: ${originalSubject}`;
    }

    it('should add Re: prefix to new subject', () => {
      expect(buildReplySubject('Hello')).toBe('Re: Hello');
    });

    it('should not double Re: prefix', () => {
      expect(buildReplySubject('Re: Hello')).toBe('Re: Hello');
      expect(buildReplySubject('RE: Hello')).toBe('RE: Hello');
      expect(buildReplySubject('re: Hello')).toBe('re: Hello');
    });

    it('should handle edge cases', () => {
      expect(buildReplySubject('')).toBe('Re: ');
      expect(buildReplySubject('Re:')).toBe('Re:');
      expect(buildReplySubject('Re: Re: Multiple')).toBe('Re: Re: Multiple');
    });
  });

  describe('References Chain Logic', () => {
    // Test the references building logic used in replyToEmail
    function buildReferences(originalReferences, originalMessageId) {
      return originalReferences
        ? `${originalReferences} ${originalMessageId}`
        : originalMessageId;
    }

    it('should use message ID when no existing references', () => {
      expect(buildReferences('', '<msg1@example.com>')).toBe('<msg1@example.com>');
      expect(buildReferences(null, '<msg1@example.com>')).toBe('<msg1@example.com>');
    });

    it('should append message ID to existing references', () => {
      expect(buildReferences('<ref1@example.com>', '<msg1@example.com>'))
        .toBe('<ref1@example.com> <msg1@example.com>');
    });

    it('should build long reference chains', () => {
      const refs = '<ref1@ex.com> <ref2@ex.com>';
      expect(buildReferences(refs, '<msg1@ex.com>'))
        .toBe('<ref1@ex.com> <ref2@ex.com> <msg1@ex.com>');
    });
  });
});
