import { vi, beforeAll } from 'vitest';

// Mock modules using __mocks__ directory (no factory = uses manual mock)
vi.mock('@google-cloud/local-auth');
vi.mock('googleapis');
vi.mock('open', () => ({ default: vi.fn() }));
vi.mock('node-notifier', () => ({ notify: vi.fn() }));

// Also mock fs.promises.access to prevent "credentials.json not found" errors
// which would trigger the authenticate flow
beforeAll(() => {
  // Prevent any process from spawning browsers
  vi.stubGlobal('open', vi.fn());
});

console.log('Global Google/Open mocks applied');
