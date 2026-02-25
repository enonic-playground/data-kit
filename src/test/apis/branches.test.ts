import type { Request } from '@enonic-types/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('/lib/xp/auth', () => ({
    hasRole: vi.fn(() => true),
}));

vi.mock('/lib/xp/repo', () => ({
    get: vi.fn(),
    createBranch: vi.fn(),
    deleteBranch: vi.fn(),
}));

import { hasRole } from '/lib/xp/auth';
import { createBranch, deleteBranch, get as getRepo } from '/lib/xp/repo';
import {
    delete as deleteHandler,
    get,
    post,
} from '../../main/resources/apis/branches/branches';

const mockedGetRepo = vi.mocked(getRepo);
const mockedCreateBranch = vi.mocked(createBranch);
const mockedDeleteBranch = vi.mocked(deleteBranch);
const mockedHasRole = vi.mocked(hasRole);

beforeEach(() => {
    vi.clearAllMocks();
    mockedHasRole.mockReturnValue(true);
});

function parseBody(response: { body?: string | object }) {
    return JSON.parse(response.body as string);
}

describe('GET /branches', () => {
    test('returns branch list for a repository', () => {
        mockedGetRepo.mockReturnValue({
            id: 'my-repo',
            branches: ['master', 'draft'],
            settings: {},
            transient: false,
        });

        const response = get({
            params: { repoId: 'my-repo' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual([
            { id: 'master' },
            { id: 'draft' },
        ]);
        expect(mockedGetRepo).toHaveBeenCalledWith('my-repo');
    });

    test('requires repoId parameter', () => {
        const response = get({
            params: {},
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 404 for non-existent repository', () => {
        mockedGetRepo.mockImplementation(() => {
            throw new Error('Repository not found');
        });

        const response = get({
            params: { repoId: 'nonexistent' },
        } as unknown as Request);
        expect(response.status).toBe(404);
        expect(parseBody(response).code).toBe('NOT_FOUND');
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = get({
            params: { repoId: 'my-repo' },
        } as unknown as Request);
        expect(response.status).toBe(403);
    });
});

describe('POST /branches', () => {
    test('creates a branch with valid input', () => {
        mockedCreateBranch.mockReturnValue({ id: 'draft' });

        const response = post({
            body: JSON.stringify({ repoId: 'my-repo', branchId: 'draft' }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(201);
        expect(body.data).toEqual({ id: 'draft' });
        expect(mockedCreateBranch).toHaveBeenCalledWith({
            repoId: 'my-repo',
            branchId: 'draft',
        });
    });

    test('rejects missing repoId', () => {
        const response = post({
            body: JSON.stringify({ branchId: 'draft' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('rejects missing branchId', () => {
        const response = post({
            body: JSON.stringify({ repoId: 'my-repo' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('rejects invalid branchId format', () => {
        const response = post({
            body: JSON.stringify({ repoId: 'my-repo', branchId: 'AB' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('rejects single character branchId', () => {
        const response = post({
            body: JSON.stringify({ repoId: 'my-repo', branchId: 'a' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
    });

    test('accepts branchId with dots and hyphens', () => {
        mockedCreateBranch.mockReturnValue({ id: 'feature.my-branch' });

        const response = post({
            body: JSON.stringify({ repoId: 'my-repo', branchId: 'feature.my-branch' }),
        } as unknown as Request);
        expect(response.status).toBe(201);
    });

    test('returns 409 for duplicate branch', () => {
        mockedCreateBranch.mockImplementation(() => {
            throw new Error('Branch already exists');
        });

        const response = post({
            body: JSON.stringify({ repoId: 'my-repo', branchId: 'master' }),
        } as unknown as Request);
        expect(response.status).toBe(409);
        expect(parseBody(response).code).toBe('CONFLICT');
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = post({
            body: JSON.stringify({ repoId: 'my-repo', branchId: 'draft' }),
        } as unknown as Request);
        expect(response.status).toBe(403);
    });
});

describe('DELETE /branches', () => {
    test('deletes a branch', () => {
        mockedDeleteBranch.mockReturnValue({ id: 'draft' });

        const response = deleteHandler({
            params: { repoId: 'my-repo', branchId: 'draft' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual({ id: 'draft', deleted: true });
        expect(mockedDeleteBranch).toHaveBeenCalledWith({
            repoId: 'my-repo',
            branchId: 'draft',
        });
    });

    test('protects master branch', () => {
        const response = deleteHandler({
            params: { repoId: 'my-repo', branchId: 'master' },
        } as unknown as Request);
        expect(response.status).toBe(403);
        expect(parseBody(response).code).toBe('PROTECTED_BRANCH');
    });

    test('requires repoId parameter', () => {
        const response = deleteHandler({
            params: { branchId: 'draft' },
        } as unknown as Request);
        expect(response.status).toBe(400);
    });

    test('requires branchId parameter', () => {
        const response = deleteHandler({
            params: { repoId: 'my-repo' },
        } as unknown as Request);
        expect(response.status).toBe(400);
    });

    test('returns 404 for non-existent branch', () => {
        mockedDeleteBranch.mockImplementation(() => {
            throw new Error('Branch not found');
        });

        const response = deleteHandler({
            params: { repoId: 'my-repo', branchId: 'nonexistent' },
        } as unknown as Request);
        expect(response.status).toBe(404);
        expect(parseBody(response).code).toBe('NOT_FOUND');
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = deleteHandler({
            params: { repoId: 'my-repo', branchId: 'draft' },
        } as unknown as Request);
        expect(response.status).toBe(403);
    });
});
