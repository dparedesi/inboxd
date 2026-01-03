const { vi } = require('vitest');

module.exports = {
  authenticate: vi.fn().mockResolvedValue({
    credentials: {
      refresh_token: 'mock-refresh-token',
      access_token: 'mock-access-token',
      expiry_date: Date.now() + 3600000
    }
  })
};
