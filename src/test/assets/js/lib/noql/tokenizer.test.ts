import { describe, expect, it } from 'vitest';

import type { Token } from '../../../../../main/resources/assets/js/lib/noql/types';

import { tokenize } from '../../../../../main/resources/assets/js/lib/noql/tokenizer';

function run(input: string): Token[] {
  const result = tokenize(input);
  if ('message' in result) {
    throw new Error(`Unexpected tokenization error: ${result.message}`);
  }
  return result;
}

describe('tokenize', () => {
  describe('simple inputs', () => {
    it('should return an empty array for an empty query', () => {
      expect(run('')).toEqual([]);
    });

    it('should return an empty array for whitespace only', () => {
      expect(run('   \t\n  ')).toEqual([]);
    });

    it('should tokenize a single identifier', () => {
      const tokens = run('_name');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'identifier',
        value: '_name',
        position: { start: 0, end: 5 },
      });
    });

    it('should tokenize dotted field paths as one identifier', () => {
      const tokens = run('data.myField');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].value).toBe('data.myField');
    });

    it('should tokenize wildcard and at-prefix identifiers', () => {
      expect(run('*')[0].value).toBe('*');
      expect(run('@geoPoint')[0].value).toBe('@geoPoint');
    });
  });

  describe('keywords', () => {
    it('should recognize keywords case-insensitively', () => {
      for (const kw of [
        'AND',
        'and',
        'And',
        'OR',
        'NOT',
        'LIKE',
        'IN',
        'ASC',
        'DESC',
        'ORDER',
        'BY',
        'COLLATE',
      ]) {
        const tokens = run(kw);
        expect(tokens[0].type).toBe('keyword');
        expect(tokens[0].value).toBe(kw.toUpperCase());
      }
    });

    it('should not confuse a keyword-like identifier prefix with a keyword', () => {
      const tokens = run('AND_field');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('identifier');
      expect(tokens[0].value).toBe('AND_field');
    });
  });

  describe('strings', () => {
    it('should tokenize a single-quoted string', () => {
      const tokens = run("'hello'");
      expect(tokens[0]).toMatchObject({
        type: 'string',
        value: 'hello',
        position: { start: 0, end: 7 },
      });
    });

    it('should tokenize a double-quoted string', () => {
      const tokens = run('"hello"');
      expect(tokens[0]).toMatchObject({ type: 'string', value: 'hello' });
    });

    it('should allow spaces and special chars inside strings', () => {
      const tokens = run("'a b, c (d)'");
      expect(tokens[0].value).toBe('a b, c (d)');
    });

    it('should report an unterminated string', () => {
      const result = tokenize("'no end");
      expect(result).toMatchObject({
        message: expect.stringContaining('Unterminated string'),
        position: { start: 0, end: 7 },
      });
    });
  });

  describe('numbers', () => {
    it('should tokenize integers', () => {
      expect(run('42')[0]).toMatchObject({ type: 'number', value: '42' });
    });

    it('should tokenize negative numbers', () => {
      expect(run('-3.14')[0]).toMatchObject({ type: 'number', value: '-3.14' });
    });

    it('should tokenize positive-signed numbers', () => {
      expect(run('+10')[0]).toMatchObject({ type: 'number', value: '+10' });
    });

    it('should tokenize decimals', () => {
      expect(run('0.5')[0]).toMatchObject({ type: 'number', value: '0.5' });
    });

    it('should report a malformed number', () => {
      const result = tokenize('1.');
      expect(result).toMatchObject({
        message: expect.stringContaining('Malformed number'),
      });
    });
  });

  describe('operators and punctuation', () => {
    it('should tokenize comparison operators', () => {
      for (const op of ['=', '!=', '>', '>=', '<', '<=']) {
        const tokens = run(op);
        expect(tokens[0]).toMatchObject({ type: 'operator', value: op });
      }
    });

    it('should tokenize parentheses and commas as distinct types', () => {
      const tokens = run('(a,b)');
      expect(tokens.map((t) => t.type)).toEqual([
        'lparen',
        'identifier',
        'comma',
        'identifier',
        'rparen',
      ]);
    });
  });

  describe('errors', () => {
    it('should report an illegal character', () => {
      const result = tokenize('a ~ b');
      expect(result).toMatchObject({
        message: expect.stringContaining("Invalid character '~'"),
        position: { start: 2, end: 3 },
      });
    });
  });

  describe('position tracking', () => {
    it('should report accurate offsets for all tokens', () => {
      const tokens = run("_name = 'x'");
      expect(tokens[0].position).toEqual({ start: 0, end: 5 });
      expect(tokens[1].position).toEqual({ start: 6, end: 7 });
      expect(tokens[2].position).toEqual({ start: 8, end: 11 });
    });
  });

  describe('realistic queries', () => {
    it('should tokenize a compare with AND', () => {
      const tokens = run("_name = 'a' AND _path LIKE '/foo*'");
      expect(tokens.map((t) => t.type)).toEqual([
        'identifier',
        'operator',
        'string',
        'keyword',
        'identifier',
        'keyword',
        'string',
      ]);
    });

    it('should tokenize an ORDER BY clause', () => {
      const tokens = run('ORDER BY _ts DESC');
      expect(tokens.map((t) => t.value)).toEqual(['ORDER', 'BY', '_ts', 'DESC']);
    });
  });
});
