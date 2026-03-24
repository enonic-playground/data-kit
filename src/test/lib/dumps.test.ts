import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockDumpManager = vi.hoisted(() => ({
    list: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
}));

vi.hoisted(() => {
    globalThis.__ = { newBean: vi.fn(() => mockDumpManager) } as unknown as typeof __;
});

vi.mock('../../main/resources/lib/management-api', () => ({
    managementApiRequest: vi.fn(),
}));

import {
    createDump,
    deleteDump,
    downloadDump,
    listDumps,
    loadDump,
    upgradeDump,
    uploadDump,
} from '../../main/resources/lib/dumps';
import { managementApiRequest } from '../../main/resources/lib/management-api';

const mockedManagementApiRequest = vi.mocked(managementApiRequest);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('listDumps', () => {
    test('returns parsed dump entries', () => {
        const dumps = [
            { name: 'dump-1', timestamp: '2026-01-01T00:00:00Z', type: 'versioned', xpVersion: '8.0.0', modelVersion: '12', size: 1024 },
        ];
        mockDumpManager.list.mockReturnValue(JSON.stringify(dumps));

        const result = listDumps();
        expect(result).toEqual(dumps);
        expect(mockDumpManager.list).toHaveBeenCalled();
    });

    test('returns empty array when no dumps', () => {
        mockDumpManager.list.mockReturnValue('[]');
        expect(listDumps()).toEqual([]);
    });
});

describe('deleteDump', () => {
    test('returns true on success', () => {
        mockDumpManager.delete.mockReturnValue(true);
        expect(deleteDump('my-dump')).toBe(true);
        expect(mockDumpManager.delete).toHaveBeenCalledWith('my-dump');
    });

    test('returns false when not found', () => {
        mockDumpManager.delete.mockReturnValue(false);
        expect(deleteDump('nonexistent')).toBe(false);
    });
});

describe('createDump', () => {
    test('calls management API with params', () => {
        const result = { taskId: 'task-123' };
        mockedManagementApiRequest.mockReturnValue(result);

        const params = { name: 'my-dump', includeVersions: true };
        expect(createDump(params, 'Bearer token')).toEqual(result);
        expect(mockedManagementApiRequest).toHaveBeenCalledWith('system/dump', {
            method: 'POST',
            body: params,
            authHeader: 'Bearer token',
        });
    });
});

describe('loadDump', () => {
    test('calls management API with params', () => {
        const result = { taskId: 'task-456' };
        mockedManagementApiRequest.mockReturnValue(result);

        const params = { name: 'my-dump', upgrade: true };
        expect(loadDump(params, 'Bearer token')).toEqual(result);
        expect(mockedManagementApiRequest).toHaveBeenCalledWith('system/load', {
            method: 'POST',
            body: params,
            authHeader: 'Bearer token',
        });
    });
});

describe('upgradeDump', () => {
    test('calls management API with name', () => {
        const result = { taskId: 'task-789' };
        mockedManagementApiRequest.mockReturnValue(result);

        expect(upgradeDump('my-dump', 'Bearer token')).toEqual(result);
        expect(mockedManagementApiRequest).toHaveBeenCalledWith('system/upgrade', {
            method: 'POST',
            body: { name: 'my-dump' },
            authHeader: 'Bearer token',
        });
    });
});

describe('downloadDump', () => {
    test('returns ByteSource from bean', () => {
        const fakeStream = { fake: 'stream' };
        mockDumpManager.download.mockReturnValue(fakeStream);
        expect(downloadDump('my-dump')).toBe(fakeStream);
        expect(mockDumpManager.download).toHaveBeenCalledWith('my-dump');
    });

    test('returns null when not found', () => {
        mockDumpManager.download.mockReturnValue(null);
        expect(downloadDump('nonexistent')).toBeNull();
    });
});

describe('uploadDump', () => {
    test('returns true on success', () => {
        mockDumpManager.upload.mockReturnValue(true);
        const fakeData = { fake: 'data' };
        expect(uploadDump('my-dump', fakeData as never)).toBe(true);
        expect(mockDumpManager.upload).toHaveBeenCalledWith('my-dump', fakeData);
    });

    test('returns false on conflict', () => {
        mockDumpManager.upload.mockReturnValue(false);
        expect(uploadDump('existing', {} as never)).toBe(false);
    });
});
