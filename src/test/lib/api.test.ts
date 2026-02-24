import type { Request } from '@enonic-types/core';
import { describe, expect, test, vi } from 'vitest';

vi.mock('/lib/xp/auth', () => ({
    hasRole: vi.fn(),
}));

import { errorResponse, getParam, jsonResponse } from '../../main/resources/lib/api';

describe('jsonResponse', () => {
    test('wraps data in ApiResponse envelope', () => {
        const result = jsonResponse({ name: 'test' });
        expect(result.status).toBe(200);
        expect(result.contentType).toBe('application/json');
        expect(JSON.parse(result.body as string)).toEqual({ data: { name: 'test' } });
    });

    test('uses custom status code', () => {
        const result = jsonResponse('created', 201);
        expect(result.status).toBe(201);
        expect(JSON.parse(result.body as string)).toEqual({ data: 'created' });
    });
});

describe('errorResponse', () => {
    test('returns error with status and message', () => {
        const result = errorResponse(404, 'Not found');
        expect(result.status).toBe(404);
        expect(result.contentType).toBe('application/json');
        expect(JSON.parse(result.body as string)).toEqual({
            status: 404,
            message: 'Not found',
        });
    });

    test('includes optional error code', () => {
        const result = errorResponse(403, 'Forbidden', 'FORBIDDEN');
        expect(JSON.parse(result.body as string)).toEqual({
            status: 403,
            message: 'Forbidden',
            code: 'FORBIDDEN',
        });
    });
});

describe('getParam', () => {
    test('returns string parameter', () => {
        const req = { params: { name: 'value' } } as unknown as Request;
        expect(getParam(req, 'name')).toBe('value');
    });

    test('returns first element of array parameter', () => {
        const req = { params: { name: ['first', 'second'] } } as unknown as Request;
        expect(getParam(req, 'name')).toBe('first');
    });

    test('returns undefined for missing parameter', () => {
        const req = { params: {} } as unknown as Request;
        expect(getParam(req, 'missing')).toBeUndefined();
    });

    test('returns undefined when params is undefined', () => {
        const req = {} as unknown as Request;
        expect(getParam(req, 'name')).toBeUndefined();
    });
});
