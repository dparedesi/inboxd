import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Module = require('module');
const gmailMonitorPath = require.resolve('../src/gmail-monitor');
const gmailAuthPath = require.resolve('../src/gmail-auth');

describe('Labels Management', () => {
  let mockGmail;
  let getGmailClient;
  let listLabels;
  let createLabel;
  let applyLabel;
  let removeLabel;
  let findLabelByName;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGmail = {
      users: {
        labels: {
          list: vi.fn(),
          create: vi.fn(),
        },
        messages: {
          modify: vi.fn(),
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
      listLabels,
      createLabel,
      applyLabel,
      removeLabel,
      findLabelByName,
    } = require('../src/gmail-monitor'));
  });

  describe('listLabels', () => {
    it('maps label data correctly', async () => {
      mockGmail.users.labels.list.mockResolvedValue({
        data: {
          labels: [
            {
              id: 'INBOX',
              name: 'INBOX',
              type: 'system',
              messagesTotal: 100,
              messagesUnread: 5,
            },
            {
              id: 'Label_1',
              name: 'Work',
              type: 'user',
              messagesTotal: 50,
              messagesUnread: 2,
              labelListVisibility: 'labelShow',
              messageListVisibility: 'show',
            },
          ],
        },
      });

      const labels = await listLabels('work');

      expect(getGmailClient).toHaveBeenCalledWith('work');
      expect(mockGmail.users.labels.list).toHaveBeenCalledWith({ userId: 'me' });
      expect(labels).toHaveLength(2);
      expect(labels[0].id).toBe('INBOX');
      expect(labels[0].type).toBe('system');
      expect(labels[1].name).toBe('Work');
    });

    it('returns empty array when no labels exist', async () => {
      mockGmail.users.labels.list.mockResolvedValue({ data: { labels: null } });

      const labels = await listLabels('work');

      expect(labels).toEqual([]);
    });
  });

  describe('createLabel', () => {
    it('creates label with expected parameters', async () => {
      mockGmail.users.labels.create.mockResolvedValue({
        data: { id: 'Label_new', name: 'New Label', type: 'user' },
      });

      const label = await createLabel('work', 'New Label');

      expect(mockGmail.users.labels.create).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          name: 'New Label',
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });
      expect(label).toEqual({ id: 'Label_new', name: 'New Label', type: 'user' });
    });
  });

  describe('applyLabel', () => {
    it('applies labels to all messages', async () => {
      mockGmail.users.messages.modify.mockResolvedValue({ data: {} });

      const results = await applyLabel('work', ['msg1', 'msg2'], 'Label_1');

      expect(results).toHaveLength(2);
      expect(results.every(r => r.success)).toBe(true);
      expect(mockGmail.users.messages.modify).toHaveBeenCalledTimes(2);
      expect(mockGmail.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg1',
        requestBody: { addLabelIds: ['Label_1'] },
      });
    });

    it('captures partial failures', async () => {
      mockGmail.users.messages.modify
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValueOnce({ data: {} });

      const results = await applyLabel('work', ['msg1', 'msg2', 'msg3'], 'Label_1');

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ id: 'msg1', success: true });
      expect(results[1]).toEqual({ id: 'msg2', success: false, error: 'Not found' });
      expect(results[2]).toEqual({ id: 'msg3', success: true });
    });
  });

  describe('removeLabel', () => {
    it('removes labels from messages', async () => {
      mockGmail.users.messages.modify.mockResolvedValue({ data: {} });

      const results = await removeLabel('work', ['msg1', 'msg2'], 'Label_1');

      expect(results).toHaveLength(2);
      expect(results.every(r => r.success)).toBe(true);
      expect(mockGmail.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg1',
        requestBody: { removeLabelIds: ['Label_1'] },
      });
    });
  });

  describe('findLabelByName', () => {
    it('finds labels case-insensitively', async () => {
      mockGmail.users.labels.list.mockResolvedValue({
        data: {
          labels: [
            { id: 'INBOX', name: 'INBOX', type: 'system' },
            { id: 'Label_1', name: 'Work', type: 'user' },
            { id: 'Label_2', name: 'Important', type: 'user' },
          ],
        },
      });

      const workLabel = await findLabelByName('work', 'work');
      const inboxLabel = await findLabelByName('work', 'INBOX');
      const missing = await findLabelByName('work', 'NonExistent');

      expect(workLabel).toBeTruthy();
      expect(workLabel.id).toBe('Label_1');
      expect(inboxLabel).toBeTruthy();
      expect(inboxLabel.type).toBe('system');
      expect(missing).toBeNull();
    });
  });
});
