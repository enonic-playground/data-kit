import { describe, expect, test } from 'vitest';
import { joinValues, toTag } from '../../main/resources/lib/text';

describe('joinValues', () => {
    test('joins non-empty values with default separator', () => {
        expect(joinValues(['a', 'b', 'c'])).toBe('a, b, c');
    });

    test('filters out empty strings', () => {
        expect(joinValues(['a', '', 'b', '', 'c'])).toBe('a, b, c');
    });

    test('trims whitespace from values', () => {
        expect(joinValues([' a ', '  b', 'c  '])).toBe('a, b, c');
    });

    test('uses custom separator', () => {
        expect(joinValues(['a', 'b', 'c'], ' | ')).toBe('a | b | c');
    });

    test('returns empty string for empty array', () => {
        expect(joinValues([])).toBe('');
    });

    test('returns empty string when all values are empty', () => {
        expect(joinValues(['', '', ''])).toBe('');
    });
});

describe('toTag', () => {
    test('formats name and value as tag', () => {
        expect(toTag('type', 'string')).toBe('type: string');
    });
});
