import { describe, expect, it } from 'vitest';

import { validate } from '../../../../../main/resources/assets/js/lib/noql/validator';

describe('validate', () => {
  describe('valid queries', () => {
    it('should accept an empty query', () => {
      expect(validate('')).toBeNull();
    });

    it('should accept whitespace only', () => {
      expect(validate('   ')).toBeNull();
    });

    it('should accept a simple compare', () => {
      expect(validate("_name = 'x'")).toBeNull();
    });

    it('should accept all comparison operators', () => {
      for (const op of ['=', '!=', '>', '>=', '<', '<=']) {
        expect(validate(`score ${op} 5`)).toBeNull();
      }
    });

    it('should accept AND / OR with precedence', () => {
      expect(validate("a = '1' AND b = '2' OR c = '3'")).toBeNull();
    });

    it('should accept NOT prefix', () => {
      expect(validate("NOT (a = '1')")).toBeNull();
    });

    it('should accept nested parentheses', () => {
      expect(validate("((a = '1') AND (b = '2'))")).toBeNull();
    });

    it('should accept LIKE and NOT LIKE', () => {
      expect(validate("_name LIKE '*x*'")).toBeNull();
      expect(validate("_name NOT LIKE '*x*'")).toBeNull();
    });

    it('should accept IN and NOT IN', () => {
      expect(validate("_name IN ('a', 'b', 'c')")).toBeNull();
      expect(validate("_name NOT IN ('a', 'b')")).toBeNull();
    });

    it('should accept ORDER BY with direction', () => {
      expect(validate('ORDER BY _ts DESC')).toBeNull();
      expect(validate('ORDER BY foo ASC, bar DESC')).toBeNull();
    });

    it('should accept ORDER BY with score()', () => {
      expect(validate('ORDER BY score() DESC')).toBeNull();
    });

    it('should accept ORDER BY with geoDistance()', () => {
      expect(validate("ORDER BY geoDistance(location, '59,10') ASC")).toBeNull();
    });

    it('should accept ORDER BY with COLLATE', () => {
      expect(validate("ORDER BY _name ASC COLLATE 'no'")).toBeNull();
    });

    it('should accept a compare plus ORDER BY', () => {
      expect(validate("_name LIKE '*x*' ORDER BY _ts DESC")).toBeNull();
    });

    it('should accept a value function call', () => {
      expect(validate("timestamp > instant('2024-01-01T00:00:00Z')")).toBeNull();
    });

    it('should accept a constraint function call', () => {
      expect(validate("fulltext('title,body', 'hello', 'AND')")).toBeNull();
    });

    it('should accept a constraint function with min and max args', () => {
      expect(validate("pathMatch('_path', '/a/b')")).toBeNull();
      expect(validate("range('age', 18, 65, 'true', 'false')")).toBeNull();
    });
  });

  describe('tokenization errors bubble up', () => {
    it('should report unterminated strings', () => {
      const err = validate("_name = 'x");
      expect(err?.message).toContain('Unterminated string');
    });

    it('should report illegal characters', () => {
      const err = validate('a ~ b');
      expect(err?.message).toContain("Invalid character '~'");
    });
  });

  describe('parse errors', () => {
    it('should report a missing closing paren', () => {
      const err = validate("(_name = 'x'");
      expect(err?.message).toMatch(/Expected '\)'|close/i);
    });

    it('should report an unexpected bare keyword', () => {
      const err = validate('BY foo');
      expect(err).not.toBeNull();
    });

    it('should report a trailing operator', () => {
      const err = validate('_name =');
      expect(err).not.toBeNull();
    });

    it('should report a dangling AND', () => {
      const err = validate("_name = 'a' AND");
      expect(err).not.toBeNull();
    });

    it('should report missing ORDER keyword', () => {
      const err = validate("_name = 'x' BY _ts");
      expect(err).not.toBeNull();
    });

    it('should report BY without ORDER', () => {
      const err = validate('BY');
      expect(err).not.toBeNull();
    });

    it('should report NOT without LIKE or IN after field', () => {
      const err = validate('_name NOT = 5');
      expect(err).not.toBeNull();
    });
  });

  describe('semantic errors', () => {
    it('should suggest fulltext for a typo', () => {
      const err = validate("fultext('title', 'foo')");
      expect(err?.message).toContain("Unknown function 'fultext'");
      expect(err?.suggestion).toBe("Did you mean 'fulltext'?");
    });

    it('should suggest score for a typo in ORDER BY', () => {
      const err = validate('ORDER BY scoor() DESC');
      expect(err?.message).toContain("Unknown function 'scoor'");
      expect(err?.suggestion).toBe("Did you mean 'score'?");
    });

    it('should report wrong arity for a constraint function', () => {
      const err = validate("fulltext('a', 'b', 'c', 'd', 'e')");
      expect(err?.message).toMatch(/fulltext.*2.{1,3}4.*5/);
    });

    it('should report wrong arity for a value function', () => {
      const err = validate("timestamp > instant('a', 'b')");
      expect(err?.message).toMatch(/instant.*1.*2/);
    });

    it('should reject a sort function used as a value', () => {
      const _err = validate('score > 0.5');
      // score is an identifier here — fine. But `x > score()` should fail as sort in value context.
      expect(validate('x > score()')?.message).toMatch(/score.*ORDER BY/);
    });

    it('should reject a value function used as a constraint', () => {
      const err = validate("instant('2024-01-01')");
      expect(err?.message).toMatch(/instant.*value function/i);
    });

    it('should accept geoDistance only in ORDER BY', () => {
      expect(validate("ORDER BY geoDistance(loc, '1,2') ASC")).toBeNull();
      expect(validate("x = geoDistance(loc, '1,2')")?.message).toMatch(/geoDistance.*ORDER BY/);
    });
  });

  describe('position and suggestion payload', () => {
    it('should include a position on unknown function', () => {
      const err = validate("fultext('a', 'b')");
      expect(err?.position).toMatchObject({ start: 0, end: 7 });
    });
  });
});
