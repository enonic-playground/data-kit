import type { Request } from '@enonic-types/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('/lib/xp/auth', () => ({
    hasRole: vi.fn(() => true),
}));

vi.mock('../../main/resources/lib/management-api', () => ({
    listSnapshots: vi.fn(),
    createSnapshot: vi.fn(),
    restoreSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
}));

import { hasRole } from '/lib/xp/auth';
import {
    delete as deleteHandler,
    get,
    post,
} from '../../main/resources/apis/snapshots/snapshots';
import {
    createSnapshot,
    deleteSnapshot,
    listSnapshots,
    restoreSnapshot,
} from '../../main/resources/lib/management-api';

const mockedHasRole = vi.mocked(hasRole);
const mockedListSnapshots = vi.mocked(listSnapshots);
const mockedCreateSnapshot = vi.mocked(createSnapshot);
const mockedRestoreSnapshot = vi.mocked(restoreSnapshot);
const mockedDeleteSnapshot = vi.mocked(deleteSnapshot);

const AUTH_HEADER = 'Basic c3U6cGFzc3dvcmQ=';

beforeEach(() => {
    vi.clearAllMocks();
    mockedHasRole.mockReturnValue(true);
});

function parseBody(response: { body?: string | object }) {
    return JSON.parse(response.body as string);
}

describe('GET /snapshots', () => {
    test('returns snapshot list', () => {
        const snapshots = [
            { name: 'snap-1', reason: 'test', timestamp: '2026-01-01T00:00:00Z', state: 'SUCCESS', indices: ['idx'] },
        ];
        mockedListSnapshots.mockReturnValue(snapshots);

        const response = get({
            headers: { Authorization: AUTH_HEADER },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual(snapshots);
        expect(mockedListSnapshots).toHaveBeenCalledWith(AUTH_HEADER);
    });

    test('passes undefined authHeader when no Authorization header', () => {
        mockedListSnapshots.mockReturnValue([]);

        get({ headers: {} } as unknown as Request);
        expect(mockedListSnapshots).toHaveBeenCalledWith(undefined);
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = get({} as Request);
        expect(response.status).toBe(403);
    });

    test('returns 502 on management API failure', () => {
        mockedListSnapshots.mockImplementation(() => {
            throw new Error('Connection refused');
        });

        const response = get({ headers: {} } as unknown as Request);
        expect(response.status).toBe(502);
        expect(parseBody(response).code).toBe('MANAGEMENT_API_ERROR');
    });
});

describe('POST /snapshots (create)', () => {
    test('creates a snapshot with repositoryId', () => {
        const snapshot = { name: 'snap-1', reason: 'test', timestamp: '2026-01-01T00:00:00Z', state: 'SUCCESS', indices: ['idx'] };
        mockedCreateSnapshot.mockReturnValue(snapshot);

        const response = post({
            headers: { Authorization: AUTH_HEADER },
            params: {},
            body: JSON.stringify({ repositoryId: 'my-repo' }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(201);
        expect(body.data).toEqual(snapshot);
        expect(mockedCreateSnapshot).toHaveBeenCalledWith('my-repo', AUTH_HEADER);
    });

    test('rejects missing repositoryId', () => {
        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({}),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({ repositoryId: 'my-repo' }),
        } as unknown as Request);
        expect(response.status).toBe(403);
    });
});

describe('POST /snapshots?action=restore', () => {
    test('restores a snapshot', () => {
        const result = { message: 'Restored', name: 'snap-1', failed: false, indices: ['idx'] };
        mockedRestoreSnapshot.mockReturnValue(result);

        const response = post({
            headers: { Authorization: AUTH_HEADER },
            params: { action: 'restore' },
            body: JSON.stringify({ snapshotName: 'snap-1', repositoryId: 'my-repo' }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual(result);
        expect(mockedRestoreSnapshot).toHaveBeenCalledWith('snap-1', 'my-repo', AUTH_HEADER);
    });

    test('rejects missing snapshotName for restore', () => {
        const response = post({
            headers: {},
            params: { action: 'restore' },
            body: JSON.stringify({}),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 502 on management API failure', () => {
        mockedRestoreSnapshot.mockImplementation(() => {
            throw new Error('Timeout');
        });

        const response = post({
            headers: {},
            params: { action: 'restore' },
            body: JSON.stringify({ snapshotName: 'snap-1' }),
        } as unknown as Request);
        expect(response.status).toBe(502);
    });
});

describe('DELETE /snapshots', () => {
    test('deletes a snapshot', () => {
        const result = { deletedSnapshots: ['snap-1'] };
        mockedDeleteSnapshot.mockReturnValue(result);

        const response = deleteHandler({
            headers: { Authorization: AUTH_HEADER },
            params: { snapshotName: 'snap-1' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual(result);
        expect(mockedDeleteSnapshot).toHaveBeenCalledWith('snap-1', AUTH_HEADER);
    });

    test('requires snapshotName parameter', () => {
        const response = deleteHandler({
            headers: {},
            params: {},
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 502 on management API failure', () => {
        mockedDeleteSnapshot.mockImplementation(() => {
            throw new Error('Connection refused');
        });

        const response = deleteHandler({
            headers: {},
            params: { snapshotName: 'snap-1' },
        } as unknown as Request);
        expect(response.status).toBe(502);
    });
});
