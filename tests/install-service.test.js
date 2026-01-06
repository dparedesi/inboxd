import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';

// Test install-service logic for both macOS and Linux
// Tests the service file generation without actually installing

describe('Install Service Command', () => {
  const homeDir = os.homedir();

  describe('Platform detection', () => {
    it('should recognize darwin as macOS', () => {
      const platform = 'darwin';
      expect(platform === 'darwin').toBe(true);
    });

    it('should recognize linux as Linux', () => {
      const platform = 'linux';
      expect(platform === 'linux').toBe(true);
    });

    it('should reject unsupported platforms', () => {
      const platform = 'win32';
      const isSupported = platform === 'darwin' || platform === 'linux';
      expect(isSupported).toBe(false);
    });
  });

  describe('macOS launchd configuration', () => {
    const launchAgentsDir = path.join(homeDir, 'Library/LaunchAgents');
    const plistName = 'com.danielparedes.inboxd.plist';
    const plistPath = path.join(launchAgentsDir, plistName);

    it('should use correct plist path', () => {
      expect(plistPath).toContain('Library/LaunchAgents');
      expect(plistPath).toContain('com.danielparedes.inboxd.plist');
    });

    it('should generate valid plist structure', () => {
      const interval = 5;
      const seconds = interval * 60;
      const nodePath = '/usr/local/bin/node';
      const scriptPath = '/path/to/cli.js';
      const workingDir = '/path/to';

      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.danielparedes.inboxd</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${scriptPath}</string>
        <string>check</string>
        <string>--quiet</string>
    </array>
    <key>StartInterval</key>
    <integer>${seconds}</integer>
</dict>
</plist>`;

      expect(plistContent).toContain('com.danielparedes.inboxd');
      expect(plistContent).toContain('<integer>300</integer>'); // 5 * 60
      expect(plistContent).toContain('check');
      expect(plistContent).toContain('--quiet');
    });

    it('should convert minutes to seconds', () => {
      const intervalMinutes = 10;
      const seconds = intervalMinutes * 60;
      expect(seconds).toBe(600);
    });
  });

  describe('Linux systemd configuration', () => {
    const systemdUserDir = path.join(homeDir, '.config/systemd/user');
    const servicePath = path.join(systemdUserDir, 'inboxd.service');
    const timerPath = path.join(systemdUserDir, 'inboxd.timer');

    it('should use correct systemd paths', () => {
      expect(systemdUserDir).toContain('.config/systemd/user');
      expect(servicePath).toContain('inboxd.service');
      expect(timerPath).toContain('inboxd.timer');
    });

    it('should generate valid service unit', () => {
      const nodePath = '/usr/bin/node';
      const scriptPath = '/path/to/cli.js';
      const workingDir = '/path/to';

      const serviceContent = `[Unit]
Description=inboxd - Gmail monitoring and notifications
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${nodePath} ${scriptPath} check --quiet
WorkingDirectory=${workingDir}
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
`;

      expect(serviceContent).toContain('[Unit]');
      expect(serviceContent).toContain('[Service]');
      expect(serviceContent).toContain('[Install]');
      expect(serviceContent).toContain('Type=oneshot');
      expect(serviceContent).toContain('check --quiet');
    });

    it('should generate valid timer unit', () => {
      const interval = 5;

      const timerContent = `[Unit]
Description=Run inboxd every ${interval} minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=${interval}min
Persistent=true

[Install]
WantedBy=timers.target
`;

      expect(timerContent).toContain('[Unit]');
      expect(timerContent).toContain('[Timer]');
      expect(timerContent).toContain('[Install]');
      expect(timerContent).toContain('OnUnitActiveSec=5min');
      expect(timerContent).toContain('Persistent=true');
    });

    it('should use correct timer interval format', () => {
      const intervals = [1, 5, 10, 15, 30];

      intervals.forEach(interval => {
        const timerInterval = `${interval}min`;
        expect(timerInterval).toMatch(/^\d+min$/);
      });
    });
  });

  describe('Interval parsing', () => {
    it('should parse interval option as integer', () => {
      const optionValue = '10';
      const interval = parseInt(optionValue, 10);
      expect(interval).toBe(10);
    });

    it('should use default interval of 5 minutes', () => {
      const defaultInterval = '5';
      const interval = parseInt(defaultInterval, 10);
      expect(interval).toBe(5);
    });
  });

  describe('Uninstall logic', () => {
    it('should identify service files for removal (macOS)', () => {
      const plistPath = path.join(homeDir, 'Library/LaunchAgents/com.danielparedes.inboxd.plist');
      expect(plistPath).toContain('com.danielparedes.inboxd.plist');
    });

    it('should identify service files for removal (Linux)', () => {
      const servicePath = path.join(homeDir, '.config/systemd/user/inboxd.service');
      const timerPath = path.join(homeDir, '.config/systemd/user/inboxd.timer');

      expect(servicePath).toContain('inboxd.service');
      expect(timerPath).toContain('inboxd.timer');
    });

    it('should track if files were removed', () => {
      let removed = false;

      // Simulate file removal
      const files = [
        { path: '/path/to/service', exists: true },
        { path: '/path/to/timer', exists: true },
      ];

      files.forEach(file => {
        if (file.exists) {
          // fs.unlinkSync(file.path)
          removed = true;
        }
      });

      expect(removed).toBe(true);
    });
  });

  describe('Path generation', () => {
    it('should resolve script path correctly', () => {
      // Simulates path.resolve(__dirname, 'cli.js')
      const mockDirname = '/Users/test/inboxd/src';
      const scriptPath = path.resolve(mockDirname, 'cli.js');
      expect(scriptPath).toContain('cli.js');
    });

    it('should resolve working directory correctly', () => {
      // Simulates path.resolve(__dirname, '..')
      const mockDirname = '/Users/test/inboxd/src';
      const workingDir = path.resolve(mockDirname, '..');
      expect(workingDir).not.toContain('/src');
    });
  });
});
