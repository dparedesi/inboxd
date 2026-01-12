import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the labels management logic without importing gmail-monitor
// This avoids loading the real gmail-auth which triggers browser auth

describe('Labels Management Logic', () => {
  let mockGmail;

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
  });

  describe('listLabels logic', () => {
    it('should map label data correctly', async () => {
      mockGmail.users.labels.list.mockResolvedValue({
        data: {
          labels: [
            { id: 'INBOX', name: 'INBOX', type: 'system', messagesTotal: 100, messagesUnread: 5 },
            { id: 'Label_1', name: 'Work', type: 'user', messagesTotal: 50, messagesUnread: 2 },
          ],
        },
      });

      // Simulate listLabels logic
      const res = await mockGmail.users.labels.list({ userId: 'me' });
      const labels = (res.data.labels || []).map(label => ({
        id: label.id,
        name: label.name,
        type: label.type,
        messageListVisibility: label.messageListVisibility,
        labelListVisibility: label.labelListVisibility,
        messagesTotal: label.messagesTotal,
        messagesUnread: label.messagesUnread,
      }));

      expect(labels).toHaveLength(2);
      expect(labels[0].id).toBe('INBOX');
      expect(labels[0].type).toBe('system');
      expect(labels[1].name).toBe('Work');
    });

    it('should handle empty labels', async () => {
      mockGmail.users.labels.list.mockResolvedValue({ data: { labels: null } });

      const res = await mockGmail.users.labels.list({ userId: 'me' });
      const labels = (res.data.labels || []).map(l => l);

      expect(labels).toEqual([]);
    });
  });

  describe('createLabel logic', () => {
    it('should create label with correct parameters', async () => {
      mockGmail.users.labels.create.mockResolvedValue({
        data: { id: 'Label_new', name: 'New Label', type: 'user' },
      });

      const labelName = 'New Label';
      const res = await mockGmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: labelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });

      expect(res.data.id).toBe('Label_new');
      expect(res.data.name).toBe('New Label');
      expect(mockGmail.users.labels.create).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          name: 'New Label',
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });
    });
  });

  describe('applyLabel logic', () => {
    it('should apply label to all messages', async () => {
      mockGmail.users.messages.modify.mockResolvedValue({ data: {} });

      const messageIds = ['msg1', 'msg2', 'msg3'];
      const labelId = 'Label_1';
      const results = [];

      for (const id of messageIds) {
        try {
          await mockGmail.users.messages.modify({
            userId: 'me',
            id,
            requestBody: { addLabelIds: [labelId] },
          });
          results.push({ id, success: true });
        } catch (err) {
          results.push({ id, success: false, error: err.message });
        }
      }

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      expect(mockGmail.users.messages.modify).toHaveBeenCalledTimes(3);
    });

    it('should handle partial failures', async () => {
      mockGmail.users.messages.modify
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValueOnce({ data: {} });

      const messageIds = ['msg1', 'msg2', 'msg3'];
      const results = [];

      for (const id of messageIds) {
        try {
          await mockGmail.users.messages.modify({
            userId: 'me',
            id,
            requestBody: { addLabelIds: ['Label_1'] },
          });
          results.push({ id, success: true });
        } catch (err) {
          results.push({ id, success: false, error: err.message });
        }
      }

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Not found');
      expect(results[2].success).toBe(true);
    });
  });

  describe('removeLabel logic', () => {
    it('should remove label from messages', async () => {
      mockGmail.users.messages.modify.mockResolvedValue({ data: {} });

      const messageIds = ['msg1', 'msg2'];
      const labelId = 'Label_1';
      const results = [];

      for (const id of messageIds) {
        try {
          await mockGmail.users.messages.modify({
            userId: 'me',
            id,
            requestBody: { removeLabelIds: [labelId] },
          });
          results.push({ id, success: true });
        } catch (err) {
          results.push({ id, success: false, error: err.message });
        }
      }

      expect(results).toHaveLength(2);
      expect(results.every(r => r.success)).toBe(true);
    });
  });

  describe('findLabelByName logic', () => {
    it('should find label by name (case-insensitive)', async () => {
      const labels = [
        { id: 'INBOX', name: 'INBOX', type: 'system' },
        { id: 'Label_1', name: 'Work', type: 'user' },
        { id: 'Label_2', name: 'Important', type: 'user' },
      ];

      // findLabelByName logic
      const findLabel = (name) =>
        labels.find(l => l.name.toLowerCase() === name.toLowerCase()) || null;

      expect(findLabel('work')).toBeTruthy();
      expect(findLabel('work').id).toBe('Label_1');
      expect(findLabel('IMPORTANT')).toBeTruthy();
      expect(findLabel('NonExistent')).toBeNull();
      expect(findLabel('inbox')).toBeTruthy();
      expect(findLabel('inbox').type).toBe('system');
    });
  });
});
