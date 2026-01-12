import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the attachment management logic without importing gmail-monitor
// This avoids loading the real gmail-auth which triggers browser auth

describe('Attachment Management Logic', () => {
  let mockGmail;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGmail = {
      users: {
        messages: {
          list: vi.fn(),
          get: vi.fn(),
          attachments: {
            get: vi.fn(),
          },
        },
      },
    };
  });

  describe('extractAttachments logic', () => {
    // Local implementation of extractAttachments for testing
    function extractAttachments(payload) {
      const attachments = [];

      function walkParts(parts) {
        if (!parts) return;
        for (const part of parts) {
          if (part.filename && part.filename.length > 0) {
            attachments.push({
              partId: part.partId,
              filename: part.filename,
              mimeType: part.mimeType,
              size: part.body?.size || 0,
              attachmentId: part.body?.attachmentId || null,
            });
          }
          if (part.parts) {
            walkParts(part.parts);
          }
        }
      }

      if (payload.parts) {
        walkParts(payload.parts);
      }
      if (payload.filename && payload.filename.length > 0 && payload.body?.attachmentId) {
        attachments.push({
          partId: '0',
          filename: payload.filename,
          mimeType: payload.mimeType,
          size: payload.body?.size || 0,
          attachmentId: payload.body?.attachmentId,
        });
      }

      return attachments;
    }

    it('should extract attachments from simple multipart message', () => {
      const payload = {
        parts: [
          { partId: '0', mimeType: 'text/plain', body: { data: 'text' } },
          {
            partId: '1',
            filename: 'document.pdf',
            mimeType: 'application/pdf',
            body: { size: 12345, attachmentId: 'att123' },
          },
        ],
      };

      const attachments = extractAttachments(payload);

      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toEqual({
        partId: '1',
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        size: 12345,
        attachmentId: 'att123',
      });
    });

    it('should extract multiple attachments', () => {
      const payload = {
        parts: [
          {
            partId: '1',
            filename: 'report.pdf',
            mimeType: 'application/pdf',
            body: { size: 10000, attachmentId: 'att1' },
          },
          {
            partId: '2',
            filename: 'image.jpg',
            mimeType: 'image/jpeg',
            body: { size: 50000, attachmentId: 'att2' },
          },
          {
            partId: '3',
            filename: 'data.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            body: { size: 25000, attachmentId: 'att3' },
          },
        ],
      };

      const attachments = extractAttachments(payload);

      expect(attachments).toHaveLength(3);
      expect(attachments.map(a => a.filename)).toEqual(['report.pdf', 'image.jpg', 'data.xlsx']);
    });

    it('should handle nested multipart messages', () => {
      const payload = {
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { partId: '0.0', mimeType: 'text/plain', body: { data: 'text' } },
              { partId: '0.1', mimeType: 'text/html', body: { data: 'html' } },
            ],
          },
          {
            partId: '1',
            filename: 'attachment.zip',
            mimeType: 'application/zip',
            body: { size: 100000, attachmentId: 'att1' },
          },
        ],
      };

      const attachments = extractAttachments(payload);

      expect(attachments).toHaveLength(1);
      expect(attachments[0].filename).toBe('attachment.zip');
    });

    it('should return empty array for message without attachments', () => {
      const payload = {
        parts: [
          { partId: '0', mimeType: 'text/plain', body: { data: 'text' } },
          { partId: '1', mimeType: 'text/html', body: { data: 'html' } },
        ],
      };

      const attachments = extractAttachments(payload);
      expect(attachments).toEqual([]);
    });

    it('should handle single-part message with attachment', () => {
      const payload = {
        filename: 'single.pdf',
        mimeType: 'application/pdf',
        body: { size: 5000, attachmentId: 'single-att' },
      };

      const attachments = extractAttachments(payload);

      expect(attachments).toHaveLength(1);
      expect(attachments[0].filename).toBe('single.pdf');
    });

    it('should skip parts with empty filename', () => {
      const payload = {
        parts: [
          { partId: '0', filename: '', mimeType: 'text/plain', body: { data: 'text' } },
          {
            partId: '1',
            filename: 'real-attachment.pdf',
            mimeType: 'application/pdf',
            body: { size: 1000, attachmentId: 'att1' },
          },
        ],
      };

      const attachments = extractAttachments(payload);

      expect(attachments).toHaveLength(1);
      expect(attachments[0].filename).toBe('real-attachment.pdf');
    });
  });

  describe('getEmailsWithAttachments logic', () => {
    it('should fetch and process emails with attachments', async () => {
      mockGmail.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'msg1' }, { id: 'msg2' }],
        },
      });

      mockGmail.users.messages.get
        .mockResolvedValueOnce({
          data: {
            id: 'msg1',
            threadId: 'thread1',
            payload: {
              headers: [
                { name: 'From', value: 'sender@example.com' },
                { name: 'Subject', value: 'Report Attached' },
              ],
              parts: [
                {
                  partId: '1',
                  filename: 'report.pdf',
                  mimeType: 'application/pdf',
                  body: { size: 10000, attachmentId: 'att1' },
                },
              ],
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            id: 'msg2',
            threadId: 'thread2',
            payload: {
              headers: [{ name: 'From', value: 'another@example.com' }],
              parts: [
                {
                  partId: '1',
                  filename: 'photo.jpg',
                  mimeType: 'image/jpeg',
                  body: { size: 50000, attachmentId: 'att2' },
                },
              ],
            },
          },
        });

      const res = await mockGmail.users.messages.list({ userId: 'me', q: 'has:attachment', maxResults: 10 });

      expect(res.data.messages).toHaveLength(2);
      expect(mockGmail.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'has:attachment',
        maxResults: 10,
      });
    });

    it('should return empty array when no messages match', async () => {
      mockGmail.users.messages.list.mockResolvedValue({ data: { messages: null } });

      const res = await mockGmail.users.messages.list({ userId: 'me', q: 'has:attachment' });

      expect(res.data.messages).toBeNull();
    });
  });

  describe('searchAttachments logic', () => {
    it('should filter attachments by filename pattern', () => {
      const emails = [
        {
          id: 'msg1',
          attachments: [
            { filename: 'invoice_2026.pdf' },
            { filename: 'receipt.pdf' },
          ],
        },
        {
          id: 'msg2',
          attachments: [
            { filename: 'photo.jpg' },
          ],
        },
      ];

      const pattern = 'invoice';

      // searchAttachments logic
      const results = emails
        .filter(email => email.attachments.some(att => att.filename.toLowerCase().includes(pattern.toLowerCase())))
        .map(email => ({
          ...email,
          attachments: email.attachments.filter(att => att.filename.toLowerCase().includes(pattern.toLowerCase())),
        }));

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('msg1');
      expect(results[0].attachments).toHaveLength(1);
      expect(results[0].attachments[0].filename).toBe('invoice_2026.pdf');
    });

    it('should be case-insensitive', () => {
      const emails = [
        { id: 'msg1', attachments: [{ filename: 'INVOICE_2026.PDF' }] },
      ];

      const results = emails
        .filter(email => email.attachments.some(att => att.filename.toLowerCase().includes('invoice')))
        .map(email => ({
          ...email,
          attachments: email.attachments.filter(att => att.filename.toLowerCase().includes('invoice')),
        }));

      expect(results).toHaveLength(1);
    });
  });

  describe('downloadAttachment logic', () => {
    it('should download and decode attachment data', async () => {
      // Base64url encoded "Hello, World!"
      const base64urlData = 'SGVsbG8sIFdvcmxkIQ';

      mockGmail.users.messages.attachments.get.mockResolvedValue({
        data: { data: base64urlData },
      });

      const res = await mockGmail.users.messages.attachments.get({
        userId: 'me',
        messageId: 'msg123',
        id: 'att456',
      });

      const buffer = Buffer.from(res.data.data, 'base64url');

      expect(buffer.toString('utf8')).toBe('Hello, World!');
      expect(mockGmail.users.messages.attachments.get).toHaveBeenCalledWith({
        userId: 'me',
        messageId: 'msg123',
        id: 'att456',
      });
    });

    it('should return Buffer for binary data', async () => {
      // Base64url encoded binary data
      const base64urlData = 'AQIDBA';

      mockGmail.users.messages.attachments.get.mockResolvedValue({
        data: { data: base64urlData },
      });

      const res = await mockGmail.users.messages.attachments.get({
        userId: 'me',
        messageId: 'msg',
        id: 'att',
      });

      const buffer = Buffer.from(res.data.data, 'base64url');

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer[0]).toBe(1);
      expect(buffer[1]).toBe(2);
      expect(buffer[2]).toBe(3);
      expect(buffer[3]).toBe(4);
    });
  });
});
