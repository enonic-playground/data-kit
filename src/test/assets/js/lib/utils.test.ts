import { describe, expect, it } from 'vitest';
import { cn } from '../../../../main/resources/assets/js/lib/utils';

describe('cn', () => {
    it('should merge class names', () => {
        expect(cn('foo', 'bar')).toBe('foo bar');
    });

    it('should handle conditional classes', () => {
        expect(cn('base', false && 'hidden', 'visible')).toBe(
            'base visible',
        );
    });

    it('should resolve tailwind conflicts', () => {
        expect(cn('px-4 py-2', 'px-6')).toBe('py-2 px-6');
    });

    it('should handle undefined and null inputs', () => {
        expect(cn('base', undefined, null, 'end')).toBe('base end');
    });

    it('should handle empty arguments', () => {
        expect(cn()).toBe('');
    });

    it('should handle array inputs', () => {
        expect(cn(['foo', 'bar'])).toBe('foo bar');
    });
});
