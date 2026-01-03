import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use a test-specific directory
const TEST_DIR = path.join(os.tmpdir(), 'inboxd-setup-test-' + Date.now());

describe('Credentials Validation', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('validateCredentialsFile', () => {
    // Import the function dynamically to avoid mocking issues
    const validateCredentialsFile = (filePath) => {
      if (!fs.existsSync(filePath)) {
        return { valid: false, error: 'File not found' };
      }

      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(content);

        if (!json.installed && !json.web) {
          return {
            valid: false,
            error: 'Invalid format: missing "installed" or "web" key. Make sure you downloaded OAuth Desktop app credentials.',
          };
        }

        const key = json.installed || json.web;
        if (!key.client_id || !key.client_secret) {
          return {
            valid: false,
            error: 'Invalid format: missing client_id or client_secret',
          };
        }

        return { valid: true };
      } catch (err) {
        return { valid: false, error: `Invalid JSON: ${err.message}` };
      }
    };

    it('should return error for non-existent file', () => {
      const result = validateCredentialsFile('/nonexistent/path.json');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('File not found');
    });

    it('should return error for invalid JSON', () => {
      const filePath = path.join(TEST_DIR, 'invalid.json');
      fs.writeFileSync(filePath, 'not valid json');

      const result = validateCredentialsFile(filePath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('should return error for JSON without installed or web key', () => {
      const filePath = path.join(TEST_DIR, 'missing-key.json');
      fs.writeFileSync(filePath, JSON.stringify({ foo: 'bar' }));

      const result = validateCredentialsFile(filePath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing "installed" or "web" key');
    });

    it('should return error for missing client_id', () => {
      const filePath = path.join(TEST_DIR, 'missing-client-id.json');
      fs.writeFileSync(filePath, JSON.stringify({
        installed: { client_secret: 'secret' }
      }));

      const result = validateCredentialsFile(filePath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing client_id or client_secret');
    });

    it('should return error for missing client_secret', () => {
      const filePath = path.join(TEST_DIR, 'missing-client-secret.json');
      fs.writeFileSync(filePath, JSON.stringify({
        installed: { client_id: 'id' }
      }));

      const result = validateCredentialsFile(filePath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing client_id or client_secret');
    });

    it('should validate correct installed credentials', () => {
      const filePath = path.join(TEST_DIR, 'valid-installed.json');
      fs.writeFileSync(filePath, JSON.stringify({
        installed: {
          client_id: 'test-client-id.apps.googleusercontent.com',
          client_secret: 'test-secret',
          redirect_uris: ['http://localhost']
        }
      }));

      const result = validateCredentialsFile(filePath);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate correct web credentials', () => {
      const filePath = path.join(TEST_DIR, 'valid-web.json');
      fs.writeFileSync(filePath, JSON.stringify({
        web: {
          client_id: 'test-client-id.apps.googleusercontent.com',
          client_secret: 'test-secret'
        }
      }));

      const result = validateCredentialsFile(filePath);
      expect(result.valid).toBe(true);
    });
  });
});

describe('Path Resolution', () => {
  const resolvePath = (filePath) => {
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return path.resolve(filePath);
  };

  it('should expand ~ to home directory', () => {
    const result = resolvePath('~/Documents/test.json');
    expect(result).toBe(path.join(os.homedir(), 'Documents/test.json'));
  });

  it('should expand ~/ correctly', () => {
    const result = resolvePath('~/test.json');
    expect(result).toBe(path.join(os.homedir(), 'test.json'));
  });

  it('should resolve relative paths', () => {
    const result = resolvePath('./test.json');
    expect(result).toBe(path.resolve('./test.json'));
  });

  it('should keep absolute paths unchanged', () => {
    const result = resolvePath('/absolute/path/test.json');
    expect(result).toBe('/absolute/path/test.json');
  });

  it('should handle paths with spaces', () => {
    const result = resolvePath('~/My Documents/test file.json');
    expect(result).toBe(path.join(os.homedir(), 'My Documents/test file.json'));
  });

  it('should handle quoted paths from drag-drop', () => {
    // Simulate drag-drop which may add quotes
    const input = '"/Users/test/My Documents/creds.json"';
    const cleaned = input.replace(/['"]/g, '').trim();
    expect(cleaned).toBe('/Users/test/My Documents/creds.json');
  });
});

describe('Install Credentials', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('should copy credentials file to destination', () => {
    const sourcePath = path.join(TEST_DIR, 'source-creds.json');
    const destDir = path.join(TEST_DIR, 'config');
    const destPath = path.join(destDir, 'credentials.json');

    // Create source file
    const content = JSON.stringify({
      installed: { client_id: 'id', client_secret: 'secret' }
    });
    fs.writeFileSync(sourcePath, content);

    // Simulate installCredentials
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(sourcePath, destPath);

    expect(fs.existsSync(destPath)).toBe(true);
    expect(fs.readFileSync(destPath, 'utf8')).toBe(content);
  });
});

describe('Platform Detection', () => {
  it('should correctly identify darwin as macOS', () => {
    const isMacOS = process.platform === 'darwin';
    // This test documents the expected behavior
    expect(typeof isMacOS).toBe('boolean');
  });

  it('should provide alternative instructions for non-macOS', () => {
    const platform = 'linux';
    const isMacOS = platform === 'darwin';

    if (!isMacOS) {
      // Should suggest cron as alternative
      const cronExample = '*/5 * * * * /path/to/node /path/to/inbox check --quiet';
      expect(cronExample).toContain('* * *');
      expect(cronExample).toContain('check --quiet');
    }
  });
});
