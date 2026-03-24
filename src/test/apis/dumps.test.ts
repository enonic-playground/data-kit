import type { Request } from '@enonic-types/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('/lib/xp/auth', () => ({
    hasRole: vi.fn(() => true),
}));

vi.mock('/lib/xp/portal', () => ({
    getMultipartItem: vi.fn(),
    getMultipartStream: vi.fn(),
}));

vi.mock('../../main/resources/lib/dumps', () => ({
    listDumps: vi.fn(),
    deleteDump: vi.fn(),
    downloadDump: vi.fn(),
    uploadDump: vi.fn(),
    createDump: vi.fn(),
    loadDump: vi.fn(),
    upgradeDump: vi.fn(),
}));

import { hasRole } from '/lib/xp/auth';
import { getMultipartItem, getMultipartStream } from '/lib/xp/portal';
import {
    delete as deleteHandler,
    get,
    post,
} from '../../main/resources/apis/dumps/dumps';
import {
    createDump,
    deleteDump,
    downloadDump,
    listDumps,
    loadDump,
    upgradeDump,
    uploadDump,
} from '../../main/resources/lib/dumps';

const mockedHasRole = vi.mocked(hasRole);
const mockedListDumps = vi.mocked(listDumps);
const mockedDeleteDump = vi.mocked(deleteDump);
const mockedDownloadDump = vi.mocked(downloadDump);
const mockedUploadDump = vi.mocked(uploadDump);
const mockedCreateDump = vi.mocked(createDump);
const mockedLoadDump = vi.mocked(loadDump);
const mockedUpgradeDump = vi.mocked(upgradeDump);
const mockedGetMultipartItem = vi.mocked(getMultipartItem);
const mockedGetMultipartStream = vi.mocked(getMultipartStream);

const AUTH_HEADER = 'Basic c3U6cGFzc3dvcmQ=';

beforeEach(() => {
    vi.clearAllMocks();
    mockedHasRole.mockReturnValue(true);
});

function parseBody(response: { body?: string | object }) {
    return JSON.parse(response.body as string);
}

describe('GET /dumps', () => {
    test('returns dump list', () => {
        const dumps = [
            { name: 'dump-1', timestamp: '2026-01-01T00:00:00Z', type: 'versioned', xpVersion: '8.0.0', modelVersion: '12', size: 1024 },
        ];
        mockedListDumps.mockReturnValue(dumps);

        const response = get({} as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual(dumps);
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = get({} as Request);
        expect(response.status).toBe(403);
    });

    test('returns 500 on bean error', () => {
        mockedListDumps.mockImplementation(() => {
            throw new Error('IO error');
        });

        const response = get({} as Request);
        expect(response.status).toBe(500);
        expect(parseBody(response).code).toBe('INTERNAL_ERROR');
    });
});

describe('POST /dumps (create)', () => {
    test('creates a dump', () => {
        const result = { taskId: 'task-123' };
        mockedCreateDump.mockReturnValue(result);

        const response = post({
            headers: { Authorization: AUTH_HEADER },
            params: {},
            body: JSON.stringify({ name: 'my-dump', includeVersions: true }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(202);
        expect(body.data).toEqual(result);
        expect(mockedCreateDump).toHaveBeenCalledWith(
            { name: 'my-dump', includeVersions: true, maxAge: undefined, maxVersions: undefined },
            AUTH_HEADER,
        );
    });

    test('rejects missing name', () => {
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
            body: JSON.stringify({ name: 'test' }),
        } as unknown as Request);
        expect(response.status).toBe(403);
    });

    test('returns 502 on management API failure', () => {
        mockedCreateDump.mockImplementation(() => {
            throw new Error('Connection refused');
        });

        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({ name: 'test' }),
        } as unknown as Request);
        expect(response.status).toBe(502);
        expect(parseBody(response).code).toBe('MANAGEMENT_API_ERROR');
    });
});

describe('POST /dumps?action=load', () => {
    test('loads a dump', () => {
        const result = { taskId: 'task-456' };
        mockedLoadDump.mockReturnValue(result);

        const response = post({
            headers: { Authorization: AUTH_HEADER },
            params: { action: 'load' },
            body: JSON.stringify({ name: 'my-dump', upgrade: true }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(202);
        expect(body.data).toEqual(result);
        expect(mockedLoadDump).toHaveBeenCalledWith(
            { name: 'my-dump', upgrade: true, archive: undefined },
            AUTH_HEADER,
        );
    });

    test('rejects missing name for load', () => {
        const response = post({
            headers: {},
            params: { action: 'load' },
            body: JSON.stringify({}),
        } as unknown as Request);
        expect(response.status).toBe(400);
    });
});

describe('POST /dumps?action=upgrade', () => {
    test('upgrades a dump', () => {
        const result = { taskId: 'task-789' };
        mockedUpgradeDump.mockReturnValue(result);

        const response = post({
            headers: { Authorization: AUTH_HEADER },
            params: { action: 'upgrade' },
            body: JSON.stringify({ name: 'my-dump' }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(202);
        expect(body.data).toEqual(result);
        expect(mockedUpgradeDump).toHaveBeenCalledWith('my-dump', AUTH_HEADER);
    });

    test('rejects missing name for upgrade', () => {
        const response = post({
            headers: {},
            params: { action: 'upgrade' },
            body: JSON.stringify({}),
        } as unknown as Request);
        expect(response.status).toBe(400);
    });
});

describe('DELETE /dumps', () => {
    test('deletes a dump', () => {
        mockedDeleteDump.mockReturnValue(true);

        const response = deleteHandler({
            params: { name: 'my-dump' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual({ success: true });
        expect(mockedDeleteDump).toHaveBeenCalledWith('my-dump');
    });

    test('requires name parameter', () => {
        const response = deleteHandler({
            params: {},
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 404 when dump not found', () => {
        mockedDeleteDump.mockReturnValue(false);

        const response = deleteHandler({
            params: { name: 'nonexistent' },
        } as unknown as Request);
        expect(response.status).toBe(404);
        expect(parseBody(response).code).toBe('NOT_FOUND');
    });

    test('returns 500 on bean error', () => {
        mockedDeleteDump.mockImplementation(() => {
            throw new Error('Permission denied');
        });

        const response = deleteHandler({
            params: { name: 'my-dump' },
        } as unknown as Request);
        expect(response.status).toBe(500);
    });
});

describe('GET /dumps?action=download', () => {
    test('returns ZIP stream on success', () => {
        const fakeStream = { fake: 'stream' };
        mockedDownloadDump.mockReturnValue(fakeStream as never);

        const response = get({
            params: { action: 'download', name: 'my-dump' },
        } as unknown as Request);

        expect(response.status).toBe(200);
        expect(response.contentType).toBe('application/zip');
        expect(response.body).toBe(fakeStream);
        expect(response.headers?.['Content-Disposition']).toBe('attachment; filename="my-dump.zip"');
    });

    test('requires name parameter', () => {
        const response = get({
            params: { action: 'download' },
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 404 when dump not found', () => {
        mockedDownloadDump.mockReturnValue(null);

        const response = get({
            params: { action: 'download', name: 'nonexistent' },
        } as unknown as Request);
        expect(response.status).toBe(404);
        expect(parseBody(response).code).toBe('NOT_FOUND');
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = get({
            params: { action: 'download', name: 'my-dump' },
        } as unknown as Request);
        expect(response.status).toBe(403);
    });
});

describe('POST /dumps?action=upload', () => {
    test('uploads a dump successfully', () => {
        const fakeStream = { fake: 'stream' };
        mockedGetMultipartItem.mockReturnValue({ fileName: 'my-dump.zip', contentType: 'application/zip', size: 1024 } as never);
        mockedGetMultipartStream.mockReturnValue(fakeStream as never);
        mockedUploadDump.mockReturnValue(true);

        const response = post({
            headers: {},
            params: { action: 'upload' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual({ success: true, name: 'my-dump' });
        expect(mockedUploadDump).toHaveBeenCalledWith('my-dump', fakeStream);
    });

    test('strips .zip extension from filename', () => {
        mockedGetMultipartItem.mockReturnValue({ fileName: 'test-dump.zip', contentType: 'application/zip', size: 512 } as never);
        mockedGetMultipartStream.mockReturnValue({} as never);
        mockedUploadDump.mockReturnValue(true);

        const response = post({
            headers: {},
            params: { action: 'upload' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(body.data.name).toBe('test-dump');
    });

    test('rejects filename with invalid characters', () => {
        mockedGetMultipartItem.mockReturnValue({ fileName: 'bad name.zip', contentType: 'application/zip', size: 512 } as never);
        mockedGetMultipartStream.mockReturnValue({} as never);

        const response = post({
            headers: {},
            params: { action: 'upload' },
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 400 when file is missing', () => {
        mockedGetMultipartItem.mockReturnValue(null);

        const response = post({
            headers: {},
            params: { action: 'upload' },
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 409 when dump already exists', () => {
        mockedGetMultipartItem.mockReturnValue({ fileName: 'existing.zip', contentType: 'application/zip', size: 1024 } as never);
        mockedGetMultipartStream.mockReturnValue({} as never);
        mockedUploadDump.mockReturnValue(false);

        const response = post({
            headers: {},
            params: { action: 'upload' },
        } as unknown as Request);
        expect(response.status).toBe(409);
        expect(parseBody(response).code).toBe('CONFLICT');
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = post({
            headers: {},
            params: { action: 'upload' },
        } as unknown as Request);
        expect(response.status).toBe(403);
    });
});
