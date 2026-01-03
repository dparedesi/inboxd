import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DIR = path.join(os.tmpdir(), 'inboxd-state-test-' + Date.now());

describe('State Management - Multi-Account', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('Per-Account State Files', () => {
    it('should generate unique state paths per account', () => {
      const getStatePath = (account) => path.join(TEST_DIR, `state-${account}.json`);

      expect(getStatePath('default')).toContain('state-default.json');
      expect(getStatePath('work')).toContain('state-work.json');
      expect(getStatePath('personal')).toContain('state-personal.json');
    });

    it('should isolate state between accounts', () => {
      const states = {
        work: { seenEmailIds: [{ id: 'work1', timestamp: Date.now() }] },
        personal: { seenEmailIds: [{ id: 'personal1', timestamp: Date.now() }] },
      };

      // Write state files
      for (const [account, state] of Object.entries(states)) {
        const statePath = path.join(TEST_DIR, `state-${account}.json`);
        fs.writeFileSync(statePath, JSON.stringify(state));
      }

      // Read and verify isolation
      const workState = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'state-work.json'), 'utf8'));
      const personalState = JSON.parse(fs.readFileSync(path.join(TEST_DIR, 'state-personal.json'), 'utf8'));

      expect(workState.seenEmailIds[0].id).toBe('work1');
      expect(personalState.seenEmailIds[0].id).toBe('personal1');
    });
  });

  describe('Seen Email Tracking', () => {
    it('should track email IDs with timestamps', () => {
      const now = Date.now();
      const seenEntry = { id: 'email123', timestamp: now };

      expect(seenEntry).toHaveProperty('id');
      expect(seenEntry).toHaveProperty('timestamp');
      expect(seenEntry.timestamp).toBeGreaterThan(0);
    });

    it('should identify new vs seen emails', () => {
      const seenIds = [
        { id: 'seen1', timestamp: Date.now() },
        { id: 'seen2', timestamp: Date.now() },
      ];

      const incomingIds = ['seen1', 'new1', 'new2'];

      const isEmailSeen = (id) => seenIds.some(item => item.id === id);
      const newEmails = incomingIds.filter(id => !isEmailSeen(id));

      expect(newEmails).toEqual(['new1', 'new2']);
    });

    it('should prune old seen emails', () => {
      const now = Date.now();
      const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
      const tenDaysAgo = now - (10 * 24 * 60 * 60 * 1000);

      const seenIds = [
        { id: 'recent', timestamp: now },
        { id: 'weekOld', timestamp: sevenDaysAgo + 1000 },
        { id: 'tooOld', timestamp: tenDaysAgo },
      ];

      const cutoff = now - (7 * 24 * 60 * 60 * 1000);
      const filtered = seenIds.filter(item => item.timestamp > cutoff);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(i => i.id)).toContain('recent');
      expect(filtered.map(i => i.id)).toContain('weekOld');
      expect(filtered.map(i => i.id)).not.toContain('tooOld');
    });
  });
});
