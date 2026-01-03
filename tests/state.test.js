import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the state module
vi.mock('../src/state', () => {
  let state = {
    lastCheck: null,
    seenEmailIds: [],
    lastNotifiedAt: null,
  };

  return {
    getState: vi.fn(() => ({ ...state })),
    updateLastCheck: vi.fn(() => {
      state.lastCheck = Date.now();
    }),
    markEmailsSeen: vi.fn((ids) => {
      const now = Date.now();
      ids.forEach((id) => {
        if (!state.seenEmailIds.some((item) => item.id === id)) {
          state.seenEmailIds.push({ id, timestamp: now });
        }
      });
    }),
    isEmailSeen: vi.fn((id) => {
      return state.seenEmailIds.some((item) => item.id === id);
    }),
    clearOldSeenEmails: vi.fn(),
    getNewEmailIds: vi.fn((ids) => {
      return ids.filter((id) => !state.seenEmailIds.some((item) => item.id === id));
    }),
    __resetState: () => {
      state = { lastCheck: null, seenEmailIds: [], lastNotifiedAt: null };
    },
  };
});

describe('State Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should track seen email IDs', async () => {
    const { markEmailsSeen, getNewEmailIds } = await import('../src/state');

    const emailIds = ['email1', 'email2', 'email3'];

    // Initially none should be seen
    const newIds = getNewEmailIds(emailIds);
    expect(newIds).toEqual(emailIds);

    // Mark some as seen
    markEmailsSeen(['email1', 'email2']);

    // Now only email3 should be new
    const afterMark = getNewEmailIds(emailIds);
    expect(afterMark).toEqual(['email3']);
  });

  it('should update last check timestamp', async () => {
    const { updateLastCheck } = await import('../src/state');

    updateLastCheck();

    expect(updateLastCheck).toHaveBeenCalled();
  });
});
