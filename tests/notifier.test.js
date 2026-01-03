import { describe, it, expect } from 'vitest';
import { extractSenderName } from '../src/notifier';

describe('Notifier', () => {
  describe('extractSenderName', () => {
    it('should extract name from "Name <email>" format', () => {
      expect(extractSenderName('John Doe <john@example.com>')).toBe('John Doe');
    });

    it('should extract name from quoted format', () => {
      expect(extractSenderName('"Jane Smith" <jane@example.com>')).toBe('Jane Smith');
    });

    it('should handle email-only format', () => {
      expect(extractSenderName('user@example.com')).toBe('user');
    });

    it('should handle undefined/null', () => {
      expect(extractSenderName(undefined)).toBe('Unknown');
      expect(extractSenderName(null)).toBe('Unknown');
    });

    it('should handle complex names', () => {
      expect(extractSenderName('Dr. John Smith Jr. <john@hospital.com>')).toBe('Dr. John Smith Jr.');
    });
  });
});
