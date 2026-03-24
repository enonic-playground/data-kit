import type { Request } from '@enonic-types/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('/lib/xp/auth', () => ({
    hasRole: vi.fn(() => true),
}));

vi.mock('/lib/xp/portal', () => ({
    getMultipartItem: vi.fn(),
    getMultipartStream: vi.fn(),
}));

vi.mock('../../main/resources/lib/exports', () => ({
    listExports: vi.fn(),
    deleteExport: vi.fn(),
    downloadExport: vi.fn(),
    uploadExport: vi.fn(),
    createExport: vi.fn(),
    importExport: vi.fn(),
}));

import { hasRole } from '/lib/xp/auth';
import { getMultipartItem, getMultipartStream } from '/lib/xp/portal';
import {
    delete as deleteHandler,
    get,
    post,
} from '../../main/resources/apis/exports/exports';
import {
    createExport,
    deleteExport,
    downloadExport,
    importExport,
    listExports,
    uploadExport,
} from '../../main/resources/lib/exports';

const mockedHasRole = vi.mocked(hasRole);
const mockedListExports = vi.mocked(listExports);
const mockedDeleteExport = vi.mocked(deleteExport);
const mockedDownloadExport = vi.mocked(downloadExport);
const mockedUploadExport = vi.mocked(uploadExport);
const mockedCreateExport = vi.mocked(createExport);
const mockedImportExport = vi.mocked(importExport);
const mockedGetMultipartItem = vi.mocked(getMultipartItem);
const mockedGetMultipartStream = vi.mocked(getMultipartStream);

beforeEach(() => {
    vi.clearAllMocks();
    mockedHasRole.mockReturnValue(true);
});

function parseBody(response: { body?: string | object }) {
    return JSON.parse(response.body as string);
}

describe('GET /exports', () => {
    test('returns export list', () => {
        const exports = [
            { name: 'export-1', timestamp: '2026-01-01T00:00:00Z', format: 'zip', nodeCount: 5, size: 1024 },
        ];
        mockedListExports.mockReturnValue(exports);

        const response = get({} as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual(exports);
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = get({} as Request);
        expect(response.status).toBe(403);
    });

    test('returns 500 on bean error', () => {
        mockedListExports.mockImplementation(() => {
            throw new Error('IO error');
        });

        const response = get({} as Request);
        expect(response.status).toBe(500);
        expect(parseBody(response).code).toBe('INTERNAL_ERROR');
    });
});

describe('POST /exports (create)', () => {
    test('creates an export', () => {
        const result = { taskId: 'task-123' };
        mockedCreateExport.mockReturnValue(result);

        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({
                exportName: 'my-export',
                repositoryId: 'com.enonic.cms.default',
                branch: 'draft',
                nodePath: '/content',
            }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(202);
        expect(body.data).toEqual(result);
        expect(mockedCreateExport).toHaveBeenCalledWith({
            exportName: 'my-export',
            repositoryId: 'com.enonic.cms.default',
            branch: 'draft',
            nodePath: '/content',
        });
    });

    test('rejects missing exportName', () => {
        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({ repositoryId: 'repo', branch: 'master', nodePath: '/' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('rejects missing repositoryId', () => {
        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({ exportName: 'test', branch: 'master', nodePath: '/' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
    });

    test('rejects missing branch', () => {
        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({ exportName: 'test', repositoryId: 'repo', nodePath: '/' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
    });

    test('rejects missing nodePath', () => {
        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({ exportName: 'test', repositoryId: 'repo', branch: 'master' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
    });

    test('rejects exportName with control characters', () => {
        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({ exportName: 'bad\nname', repositoryId: 'repo', branch: 'master', nodePath: '/' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('rejects exportName with path separators', () => {
        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({ exportName: '../etc/passwd', repositoryId: 'repo', branch: 'master', nodePath: '/' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({ exportName: 'test', repositoryId: 'repo', branch: 'master', nodePath: '/' }),
        } as unknown as Request);
        expect(response.status).toBe(403);
    });

    test('returns 500 on error', () => {
        mockedCreateExport.mockImplementation(() => {
            throw new Error('Task failed');
        });

        const response = post({
            headers: {},
            params: {},
            body: JSON.stringify({ exportName: 'test', repositoryId: 'repo', branch: 'master', nodePath: '/' }),
        } as unknown as Request);
        expect(response.status).toBe(500);
        expect(parseBody(response).code).toBe('INTERNAL_ERROR');
    });
});

describe('POST /exports?action=import', () => {
    test('imports an export', () => {
        const result = { taskId: 'task-456' };
        mockedImportExport.mockReturnValue(result);

        const response = post({
            headers: {},
            params: { action: 'import' },
            body: JSON.stringify({
                exportName: 'my-export',
                repositoryId: 'com.enonic.cms.default',
                branch: 'draft',
                targetNodePath: '/content',
                includeNodeIds: true,
                includePermissions: true,
            }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(202);
        expect(body.data).toEqual(result);
        expect(mockedImportExport).toHaveBeenCalledWith({
            exportName: 'my-export',
            repositoryId: 'com.enonic.cms.default',
            branch: 'draft',
            targetNodePath: '/content',
            includeNodeIds: true,
            includePermissions: true,
        });
    });

    test('rejects missing exportName for import', () => {
        const response = post({
            headers: {},
            params: { action: 'import' },
            body: JSON.stringify({ repositoryId: 'repo', branch: 'master', targetNodePath: '/' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
    });

    test('rejects missing repositoryId for import', () => {
        const response = post({
            headers: {},
            params: { action: 'import' },
            body: JSON.stringify({ exportName: 'test', branch: 'master', targetNodePath: '/' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
    });

    test('rejects missing branch for import', () => {
        const response = post({
            headers: {},
            params: { action: 'import' },
            body: JSON.stringify({ exportName: 'test', repositoryId: 'repo', targetNodePath: '/' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
    });

    test('rejects missing targetNodePath for import', () => {
        const response = post({
            headers: {},
            params: { action: 'import' },
            body: JSON.stringify({ exportName: 'test', repositoryId: 'repo', branch: 'master' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
    });

    test('rejects exportName with invalid characters for import', () => {
        const response = post({
            headers: {},
            params: { action: 'import' },
            body: JSON.stringify({ exportName: 'bad name', repositoryId: 'repo', branch: 'master', targetNodePath: '/' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });
});

describe('DELETE /exports', () => {
    test('deletes an export', () => {
        mockedDeleteExport.mockReturnValue(true);

        const response = deleteHandler({
            params: { name: 'my-export' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual({ success: true });
        expect(mockedDeleteExport).toHaveBeenCalledWith('my-export');
    });

    test('requires name parameter', () => {
        const response = deleteHandler({
            params: {},
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 404 when export not found', () => {
        mockedDeleteExport.mockReturnValue(false);

        const response = deleteHandler({
            params: { name: 'nonexistent' },
        } as unknown as Request);
        expect(response.status).toBe(404);
        expect(parseBody(response).code).toBe('NOT_FOUND');
    });

    test('returns 500 on bean error', () => {
        mockedDeleteExport.mockImplementation(() => {
            throw new Error('Permission denied');
        });

        const response = deleteHandler({
            params: { name: 'my-export' },
        } as unknown as Request);
        expect(response.status).toBe(500);
    });
});

describe('GET /exports?action=download', () => {
    test('returns ZIP stream on success', () => {
        const fakeStream = { fake: 'stream' };
        mockedDownloadExport.mockReturnValue(fakeStream as never);

        const response = get({
            params: { action: 'download', name: 'my-export' },
        } as unknown as Request);

        expect(response.status).toBe(200);
        expect(response.contentType).toBe('application/zip');
        expect(response.body).toBe(fakeStream);
        expect(response.headers?.['Content-Disposition']).toBe('attachment; filename="my-export.zip"');
    });

    test('requires name parameter', () => {
        const response = get({
            params: { action: 'download' },
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 404 when export not found', () => {
        mockedDownloadExport.mockReturnValue(null);

        const response = get({
            params: { action: 'download', name: 'nonexistent' },
        } as unknown as Request);
        expect(response.status).toBe(404);
        expect(parseBody(response).code).toBe('NOT_FOUND');
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = get({
            params: { action: 'download', name: 'my-export' },
        } as unknown as Request);
        expect(response.status).toBe(403);
    });
});

describe('POST /exports?action=upload', () => {
    test('uploads an export successfully', () => {
        const fakeStream = { fake: 'stream' };
        mockedGetMultipartItem.mockReturnValue({ fileName: 'my-export.zip', contentType: 'application/zip', size: 1024 } as never);
        mockedGetMultipartStream.mockReturnValue(fakeStream as never);
        mockedUploadExport.mockReturnValue(true);

        const response = post({
            headers: {},
            params: { action: 'upload' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual({ success: true, name: 'my-export' });
        expect(mockedUploadExport).toHaveBeenCalledWith('my-export', fakeStream);
    });

    test('strips .zip extension from filename', () => {
        mockedGetMultipartItem.mockReturnValue({ fileName: 'test-export.zip', contentType: 'application/zip', size: 512 } as never);
        mockedGetMultipartStream.mockReturnValue({} as never);
        mockedUploadExport.mockReturnValue(true);

        const response = post({
            headers: {},
            params: { action: 'upload' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(body.data.name).toBe('test-export');
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

    test('returns 409 when export already exists', () => {
        mockedGetMultipartItem.mockReturnValue({ fileName: 'existing.zip', contentType: 'application/zip', size: 1024 } as never);
        mockedGetMultipartStream.mockReturnValue({} as never);
        mockedUploadExport.mockReturnValue(false);

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
