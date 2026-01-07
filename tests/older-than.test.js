import { describe, it, expect } from 'vitest';

// Test the older-than parsing logic used in inboxd analyze command
// We test the logic patterns directly since the function is not exported

describe('Older Than Duration Parsing', () => {
  /**
   * Parsing function matching the implementation in cli.js
   * Gmail only supports days (d) for older_than, so we convert weeks/months to days
   */
  function parseOlderThanDuration(duration) {
    const match = duration.match(/^(\d+)([dwm])$/i);
    if (!match) {
      return null;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 'd': // days
        return `${value}d`;
      case 'w': // weeks -> days
        return `${value * 7}d`;
      case 'm': // months (approximate as 30 days)
        return `${value * 30}d`;
      default:
        return null;
    }
  }

  describe('Days parsing', () => {
    it('should parse days correctly', () => {
      expect(parseOlderThanDuration('30d')).toBe('30d');
      expect(parseOlderThanDuration('7d')).toBe('7d');
      expect(parseOlderThanDuration('1d')).toBe('1d');
      expect(parseOlderThanDuration('90d')).toBe('90d');
    });
  });

  describe('Weeks conversion', () => {
    it('should convert weeks to days', () => {
      expect(parseOlderThanDuration('2w')).toBe('14d');
      expect(parseOlderThanDuration('1w')).toBe('7d');
      expect(parseOlderThanDuration('4w')).toBe('28d');
    });
  });

  describe('Months conversion', () => {
    it('should convert months to days (approx 30)', () => {
      expect(parseOlderThanDuration('1m')).toBe('30d');
      expect(parseOlderThanDuration('3m')).toBe('90d');
      expect(parseOlderThanDuration('6m')).toBe('180d');
    });
  });

  describe('Case insensitivity', () => {
    it('should handle uppercase units', () => {
      expect(parseOlderThanDuration('30D')).toBe('30d');
      expect(parseOlderThanDuration('2W')).toBe('14d');
      expect(parseOlderThanDuration('1M')).toBe('30d');
    });
  });

  describe('Invalid formats', () => {
    it('should return null for number without unit', () => {
      expect(parseOlderThanDuration('30')).toBe(null);
    });

    it('should return null for unit without number', () => {
      expect(parseOlderThanDuration('d')).toBe(null);
      expect(parseOlderThanDuration('days')).toBe(null);
    });

    it('should return null for unsupported units', () => {
      expect(parseOlderThanDuration('30h')).toBe(null); // hours not supported
      expect(parseOlderThanDuration('30s')).toBe(null); // seconds not supported
      expect(parseOlderThanDuration('30y')).toBe(null); // years not supported
    });

    it('should return null for empty/invalid strings', () => {
      expect(parseOlderThanDuration('')).toBe(null);
      expect(parseOlderThanDuration('abc')).toBe(null);
      expect(parseOlderThanDuration('30 d')).toBe(null); // space not allowed
    });
  });
});

describe('Gmail Query Building for Older Than', () => {
  /**
   * Helper to simulate query building logic from cli.js analyze command
   */
  function buildQuery(includeRead, olderThanDays) {
    const baseQuery = includeRead ? '' : 'is:unread';
    if (!olderThanDays) {
      return baseQuery;
    }
    const olderThanQuery = `older_than:${olderThanDays}`;
    return baseQuery ? `${baseQuery} ${olderThanQuery}` : olderThanQuery;
  }

  it('should build correct query for unread + older_than', () => {
    const query = buildQuery(false, '30d');
    expect(query).toBe('is:unread older_than:30d');
  });

  it('should build correct query for all + older_than', () => {
    const query = buildQuery(true, '30d');
    expect(query).toBe('older_than:30d');
  });

  it('should build correct query for unread only (no older_than)', () => {
    const query = buildQuery(false, null);
    expect(query).toBe('is:unread');
  });

  it('should build correct query for all (no older_than)', () => {
    const query = buildQuery(true, null);
    expect(query).toBe('');
  });

  it('should work with week/month converted to days', () => {
    // 2 weeks = 14 days
    const query = buildQuery(false, '14d');
    expect(query).toBe('is:unread older_than:14d');
  });
});
