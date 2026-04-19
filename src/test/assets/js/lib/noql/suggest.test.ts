import { describe, expect, it } from 'vitest';
import { closestName } from '../../../../../main/resources/assets/js/lib/noql/suggest';

const VALUE_FUNCS = ['geoPoint', 'instant', 'dateTime', 'localDateTime', 'time', 'date'];
const ALL_FUNCS = [
    ...VALUE_FUNCS,
    'fulltext',
    'ngram',
    'stemmed',
    'range',
    'pathMatch',
    'score',
    'geoDistance',
];

describe('closestName', () => {
    it('should suggest fulltext for a one-char typo', () => {
        expect(closestName('fultext', ALL_FUNCS)).toBe('fulltext');
    });

    it('should suggest score for a one-char typo', () => {
        expect(closestName('scoor', ALL_FUNCS)).toBe('score');
    });

    it('should suggest geoDistance for a two-char typo', () => {
        expect(closestName('geoDistnc', ALL_FUNCS)).toBe('geoDistance');
    });

    it('should return undefined when no candidate is within the cutoff', () => {
        expect(closestName('xyz', ALL_FUNCS)).toBeUndefined();
    });

    it('should return undefined for an empty input', () => {
        expect(closestName('', ALL_FUNCS)).toBeUndefined();
    });

    it('should be case-insensitive on the input', () => {
        expect(closestName('FULTEXT', ALL_FUNCS)).toBe('fulltext');
    });

    it('should return exact match when input matches a candidate', () => {
        expect(closestName('fulltext', ALL_FUNCS)).toBe('fulltext');
    });

    it('should return undefined when candidates list is empty', () => {
        expect(closestName('fulltext', [])).toBeUndefined();
    });
});
