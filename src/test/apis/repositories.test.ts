import type { Request } from '@enonic-types/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('/lib/xp/auth', () => ({
    hasRole: vi.fn(() => true),
}));

vi.mock('/lib/xp/repo', () => ({
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
}));

import { hasRole } from '/lib/xp/auth';
import { create, delete as deleteRepo, list } from '/lib/xp/repo';
import {
    delete as deleteHandler,
    get,
    post,
} from '../../main/resources/apis/repositories/repositories';

const mockedList = vi.mocked(list);
const mockedCreate = vi.mocked(create);
const mockedDelete = vi.mocked(deleteRepo);
const mockedHasRole = vi.mocked(hasRole);

beforeEach(() => {
    vi.clearAllMocks();
    mockedHasRole.mockReturnValue(true);
});

function parseBody(response: { body?: string | object }) {
    return JSON.parse(response.body as string);
}

describe('GET /repositories', () => {
    test('returns mapped repository list', () => {
        mockedList.mockReturnValue([
            { id: 'system-repo', branches: ['master'], settings: {}, transient: false },
            { id: 'my-repo', branches: ['master', 'draft'], settings: {}, transient: false },
        ]);

        const response = get({} as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual([
            { id: 'system-repo', branches: ['master'] },
            { id: 'my-repo', branches: ['master', 'draft'] },
        ]);
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = get({} as Request);
        expect(response.status).toBe(403);
    });
});

describe('POST /repositories', () => {
    test('creates a repository with valid ID', () => {
        mockedCreate.mockReturnValue({
            id: 'new-repo',
            branches: ['master'],
            transient: false,
        });

        const response = post({
            body: JSON.stringify({ id: 'new-repo' }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(201);
        expect(body.data).toEqual({ id: 'new-repo', branches: ['master'] });
        expect(mockedCreate).toHaveBeenCalledWith({ id: 'new-repo' });
    });

    test('rejects missing ID', () => {
        const response = post({
            body: JSON.stringify({}),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('rejects invalid ID format', () => {
        const response = post({
            body: JSON.stringify({ id: 'AB' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('rejects ID with uppercase letters', () => {
        const response = post({
            body: JSON.stringify({ id: 'Invalid-Repo' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
    });

    test('accepts ID with dots and hyphens', () => {
        mockedCreate.mockReturnValue({
            id: 'com.enonic.my-repo',
            branches: ['master'],
            transient: false,
        });

        const response = post({
            body: JSON.stringify({ id: 'com.enonic.my-repo' }),
        } as unknown as Request);
        expect(response.status).toBe(201);
    });
});

describe('DELETE /repositories', () => {
    test('deletes a repository', () => {
        mockedDelete.mockReturnValue(true);

        const response = deleteHandler({
            params: { id: 'my-repo' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual({ id: 'my-repo', deleted: true });
    });

    test('guards system-repo', () => {
        const response = deleteHandler({
            params: { id: 'system-repo' },
        } as unknown as Request);
        expect(response.status).toBe(403);
        expect(parseBody(response).code).toBe('PROTECTED_REPO');
    });

    test('guards com.enonic.cms.default', () => {
        const response = deleteHandler({
            params: { id: 'com.enonic.cms.default' },
        } as unknown as Request);
        expect(response.status).toBe(403);
        expect(parseBody(response).code).toBe('PROTECTED_REPO');
    });

    test('returns 404 for non-existent repo', () => {
        mockedDelete.mockReturnValue(false);

        const response = deleteHandler({
            params: { id: 'nonexistent' },
        } as unknown as Request);
        expect(response.status).toBe(404);
    });

    test('requires ID parameter', () => {
        const response = deleteHandler({
            params: {},
        } as unknown as Request);
        expect(response.status).toBe(400);
    });
});
