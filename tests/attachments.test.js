import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Module = require('module');
const gmailMonitorPath = require.resolve('../src/gmail-monitor');
const gmailAuthPath = require.resolve('../src/gmail-auth');

describe('Attachment Management', () => {
  let mockGmail;
  let getGmailClient;
  let extractAttachments;
  let getEmailsWithAttachments;
  let searchAttachments;
  let downloadAttachment;

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

    getGmailClient = vi.fn().mockResolvedValue(mockGmail);
    delete require.cache[gmailMonitorPath];
    delete require.cache[gmailAuthPath];
    const authModule = new Module.Module(gmailAuthPath);
    authModule.exports = { getGmailClient };
    require.cache[gmailAuthPath] = authModule;

    ({
      extractAttachments,
      getEmailsWithAttachments,
      searchAttachments,
      downloadAttachment,
    } = require('../src/gmail-monitor'));
  });

  describe('extractAttachments', () => {
    it('extracts attachments from multipart payloads', () => {
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

    it('walks nested multipart structures', () => {
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

    it('handles single-part messages with attachments', () => {
      const payload = {
        filename: 'single.pdf',
        mimeType: 'application/pdf',
        body: { size: 5000, attachmentId: 'single-att' },
      };

      const attachments = extractAttachments(payload);

      expect(attachments).toHaveLength(1);
      expect(attachments[0].filename).toBe('single.pdf');
    });

    it('skips parts with empty filenames', () => {
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

    it('returns an empty array when no attachments exist', () => {
      const payload = {
        parts: [
          { partId: '0', mimeType: 'text/plain', body: { data: 'text' } },
          { partId: '1', mimeType: 'text/html', body: { data: 'html' } },
        ],
      };

      const attachments = extractAttachments(payload);
      expect(attachments).toEqual([]);
    });
  });

  describe('getEmailsWithAttachments', () => {
    it('returns messages that include attachment metadata', async () => {
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
                { name: 'Date', value: 'Mon, 1 Jan 2024 10:00:00 +0000' },
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
              headers: [{ name: 'From', value: 'no-attach@example.com' }],
              parts: [
                { partId: '0', mimeType: 'text/plain', body: { data: 'text' } },
              ],
            },
          },
        });

      const results = await getEmailsWithAttachments('work', { maxResults: 10 });

      expect(getGmailClient).toHaveBeenCalledWith('work');
      expect(mockGmail.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'has:attachment',
        maxResults: 10,
      });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'msg1',
        threadId: 'thread1',
        account: 'work',
        from: 'sender@example.com',
        subject: 'Report Attached',
      });
      expect(results[0].attachments).toHaveLength(1);
    });

    it('supports additional search queries', async () => {
      mockGmail.users.messages.list.mockResolvedValue({
        data: {
          messages: [],
        },
      });

      await getEmailsWithAttachments('work', { maxResults: 5, query: 'from:example.com' });

      expect(mockGmail.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'has:attachment from:example.com',
        maxResults: 5,
      });
    });
  });

  describe('searchAttachments', () => {
    it('filters attachments by filename pattern', async () => {
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
              headers: [{ name: 'From', value: 'sender@example.com' }],
              parts: [
                {
                  partId: '1',
                  filename: 'invoice_2026.pdf',
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

      const results = await searchAttachments('work', 'invoice', { maxResults: 10 });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('msg1');
      expect(results[0].attachments).toHaveLength(1);
      expect(results[0].attachments[0].filename).toBe('invoice_2026.pdf');
    });

    it('matches filenames case-insensitively', async () => {
      mockGmail.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'msg1' }],
        },
      });

      mockGmail.users.messages.get.mockResolvedValueOnce({
        data: {
          id: 'msg1',
          threadId: 'thread1',
          payload: {
            headers: [{ name: 'From', value: 'sender@example.com' }],
            parts: [
              {
                partId: '1',
                filename: 'INVOICE_2026.PDF',
                mimeType: 'application/pdf',
                body: { size: 10000, attachmentId: 'att1' },
              },
            ],
          },
        },
      });

      const results = await searchAttachments('work', 'invoice', { maxResults: 10 });

      expect(results).toHaveLength(1);
      expect(results[0].attachments[0].filename).toBe('INVOICE_2026.PDF');
    });
  });

  describe('downloadAttachment', () => {
    it('downloads and decodes attachment data', async () => {
      const base64urlData = 'SGVsbG8sIFdvcmxkIQ';

      mockGmail.users.messages.attachments.get.mockResolvedValue({
        data: { data: base64urlData },
      });

      const buffer = await downloadAttachment('work', 'msg123', 'att456');

      expect(buffer.toString('utf8')).toBe('Hello, World!');
      expect(mockGmail.users.messages.attachments.get).toHaveBeenCalledWith({
        userId: 'me',
        messageId: 'msg123',
        id: 'att456',
      });
    });
  });
});
