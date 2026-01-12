import { describe, it, expect } from 'vitest';

const { parseIdsInput } = require('../src/id-utils');

describe('parseIdsInput', () => {
  it('parses comma-separated IDs', () => {
    expect(parseIdsInput('id1,id2,id3')).toEqual(['id1', 'id2', 'id3']);
  });

  it('parses whitespace-separated IDs', () => {
    expect(parseIdsInput('id1 id2\nid3')).toEqual(['id1', 'id2', 'id3']);
  });

  it('parses JSON array of IDs', () => {
    expect(parseIdsInput('["id1","id2"]')).toEqual(['id1', 'id2']);
  });

  it('parses JSON array of objects with id', () => {
    expect(parseIdsInput('[{"id":"id1"},{"id":"id2"}]')).toEqual(['id1', 'id2']);
  });

  it('parses JSON object with ids field', () => {
    expect(parseIdsInput('{"ids":["id1","id2"]}')).toEqual(['id1', 'id2']);
  });

  it('parses JSON object with emails array', () => {
    const input = '{"emails":[{"id":"a"},{"id":"b"}]}';
    expect(parseIdsInput(input)).toEqual(['a', 'b']);
  });

  it('handles empty input', () => {
    expect(parseIdsInput('')).toEqual([]);
    expect(parseIdsInput('   ')).toEqual([]);
  });

  it('strips "IDs:" prefix', () => {
    expect(parseIdsInput('IDs: id1,id2')).toEqual(['id1', 'id2']);
  });
});
