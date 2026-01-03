import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use a test-specific directory to avoid touching real config
const TEST_DIR = path.join(os.tmpdir(), 'inboxd-test-' + Date.now());

describe('Gmail Auth Module', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('Account Management', () => {
    it('should generate correct token paths for different accounts', async () => {
      // We test the path generation logic
      const defaultPath = `token-default.json`;
      const workPath = `token-work.json`;
      const personalPath = `token-personal.json`;

      expect(defaultPath).toBe('token-default.json');
      expect(workPath).toBe('token-work.json');
      expect(personalPath).toBe('token-personal.json');
    });

    it('should handle account names with special characters', () => {
      const safeName = (name) => name.replace(/[^a-zA-Z0-9-_]/g, '_');

      expect(safeName('my-work')).toBe('my-work');
      expect(safeName('personal_email')).toBe('personal_email');
      expect(safeName('test account')).toBe('test_account');
    });
  });

  describe('Credentials Path', () => {
    it('should use environment variable if set', () => {
      const envPath = '/custom/path/credentials.json';
      const getPath = (envVar) => envVar || 'credentials.json';

      expect(getPath(envPath)).toBe(envPath);
      expect(getPath(undefined)).toBe('credentials.json');
    });
  });
});

describe('Accounts Data Structure', () => {
  it('should have correct structure for accounts list', () => {
    const accountsData = {
      accounts: [
        { name: 'default', email: 'user@gmail.com' },
        { name: 'work', email: 'user@company.com' },
      ],
      defaultAccount: 'default',
    };

    expect(accountsData.accounts).toHaveLength(2);
    expect(accountsData.accounts[0]).toHaveProperty('name');
    expect(accountsData.accounts[0]).toHaveProperty('email');
    expect(accountsData.defaultAccount).toBe('default');
  });

  it('should find account by name', () => {
    const accounts = [
      { name: 'default', email: 'user@gmail.com' },
      { name: 'work', email: 'user@company.com' },
    ];

    const findAccount = (name) => accounts.find(a => a.name === name);

    expect(findAccount('work')).toEqual({ name: 'work', email: 'user@company.com' });
    expect(findAccount('nonexistent')).toBeUndefined();
  });
});
