const { vi } = require('vitest');

const mockGmail = {
  users: {
    messages: {
      list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
      get: vi.fn().mockResolvedValue({
        data: {
          id: '123',
          threadId: 'thread123',
          labelIds: ['INBOX'],
          snippet: 'snippet',
          payload: { headers: [] }
        }
      }),
      trash: vi.fn().mockResolvedValue({ data: { id: '123', labelIds: ['TRASH'] } }),
      untrash: vi.fn().mockResolvedValue({ data: { id: '123', labelIds: ['INBOX'] } }),
      modify: vi.fn().mockResolvedValue({ data: { id: '123' } }),
    },
    labels: {
      get: vi.fn().mockResolvedValue({ data: { messagesUnread: 5 } }),
      list: vi.fn().mockResolvedValue({ data: { labels: [] } }),
    },
    getProfile: vi.fn().mockResolvedValue({ data: { emailAddress: 'test@example.com' } }),
  }
};

const mockAuth = {
  fromJSON: vi.fn().mockReturnValue({}),
  OAuth2: vi.fn().mockImplementation(() => ({
    generateAuthUrl: vi.fn().mockReturnValue('http://mock-auth-url'),
    getToken: vi.fn().mockResolvedValue({ tokens: {} }),
    setCredentials: vi.fn(),
  })),
};

module.exports = {
  google: {
    gmail: vi.fn().mockReturnValue(mockGmail),
    auth: mockAuth,
  }
};
