import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('/lib/http-client', () => ({
    request: vi.fn(),
}));

const { mockGetJwtConfig, mockGenerateBearerToken } = vi.hoisted(() => ({
    mockGetJwtConfig: vi.fn(),
    mockGenerateBearerToken: vi.fn(),
}));
vi.mock('../../main/resources/lib/jwt', () => ({
    getJwtConfig: mockGetJwtConfig,
    generateBearerToken: mockGenerateBearerToken,
}));

import { request } from '/lib/http-client';
import {
    createSnapshot,
    deleteSnapshot,
    getManagementApiCredentials,
    getManagementApiUrl,
    listSnapshots,
    restoreSnapshot,
} from '../../main/resources/lib/management-api';

const mockedRequest = vi.mocked(request);

const MOCK_CONFIG = {
    'managementApi.url': 'http://localhost:4848',
    'managementApi.user': 'su',
    'managementApi.password': 'password',
};

function mockOkResponse(body: unknown) {
    mockedRequest.mockReturnValue({
        status: 200,
        message: 'OK',
        headers: {},
        cookies: {},
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Record<string, unknown>).app = { config: { ...MOCK_CONFIG } };
});

describe('getManagementApiUrl', () => {
    test('returns url from app.config', () => {
        expect(getManagementApiUrl()).toBe('http://localhost:4848');
    });

    test('defaults to localhost:4848 when not set', () => {
        (globalThis as Record<string, unknown>).app = { config: {} };
        expect(getManagementApiUrl()).toBe('http://localhost:4848');
    });
});

describe('getManagementApiCredentials', () => {
    test('returns user and password from app.config', () => {
        expect(getManagementApiCredentials()).toEqual({ user: 'su', password: 'password' });
    });

    test('throws when user is missing', () => {
        (globalThis as Record<string, unknown>).app = {
            config: { 'managementApi.password': 'password' },
        };
        expect(() => getManagementApiCredentials()).toThrow('credentials not configured');
    });

    test('throws when password is missing', () => {
        (globalThis as Record<string, unknown>).app = {
            config: { 'managementApi.user': 'su' },
        };
        expect(() => getManagementApiCredentials()).toThrow('credentials not configured');
    });
});

describe('listSnapshots', () => {
    test('returns snapshot list', () => {
        const snapshots = [
            { name: 'snap-1', reason: 'test', timestamp: '2026-01-01T00:00:00Z', state: 'SUCCESS', indices: ['idx'] },
        ];
        mockOkResponse({ results: snapshots });

        const result = listSnapshots();
        expect(result).toEqual(snapshots);
        expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
            url: 'http://localhost:4848/repo/snapshot/list',
            method: 'GET',
            auth: { user: 'su', password: 'password' },
        }));
    });

    test('forwards auth header instead of config credentials', () => {
        mockOkResponse({ results: [] });

        listSnapshots('Basic dGVzdDpwYXNz');
        expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
            headers: { Authorization: 'Basic dGVzdDpwYXNz' },
        }));
        // Should NOT have auth when authHeader is provided
        const callArgs = mockedRequest.mock.calls[0][0];
        expect(callArgs).not.toHaveProperty('auth');
    });

    test('throws on non-2xx status', () => {
        mockedRequest.mockReturnValue({
            status: 500,
            message: 'Internal Server Error',
            headers: {},
            cookies: {},
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Something broke' }),
        });

        expect(() => listSnapshots()).toThrow('Management API error 500: Something broke');
    });

    test('throws on empty body', () => {
        mockedRequest.mockReturnValue({
            status: 200,
            message: 'OK',
            headers: {},
            cookies: {},
            contentType: 'application/json',
            body: null,
        });

        expect(() => listSnapshots()).toThrow('empty response');
    });
});

describe('createSnapshot', () => {
    test('sends repositoryId in body', () => {
        const snapshot = { name: 'snap-1', reason: 'test', timestamp: '2026-01-01T00:00:00Z', state: 'SUCCESS', indices: ['idx'] };
        mockOkResponse(snapshot);

        const result = createSnapshot('my-repo');
        expect(result).toEqual(snapshot);
        expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
            url: 'http://localhost:4848/repo/snapshot',
            method: 'POST',
            body: JSON.stringify({ repositoryId: 'my-repo' }),
        }));
    });

    test('forwards auth header', () => {
        mockOkResponse({ name: 'snap-1', reason: '', timestamp: '', state: 'SUCCESS', indices: [] });

        createSnapshot('my-repo', 'Basic abc123');
        expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
            headers: { Authorization: 'Basic abc123' },
        }));
    });
});

describe('restoreSnapshot', () => {
    test('sends snapshotName and optional repositoryId', () => {
        const response = { message: 'Restored', name: 'snap-1', failed: false, indices: ['idx'] };
        mockOkResponse(response);

        const result = restoreSnapshot('snap-1', 'my-repo');
        expect(result).toEqual(response);
        expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
            body: JSON.stringify({ snapshotName: 'snap-1', repositoryId: 'my-repo' }),
        }));
    });

    test('omits repositoryId when not provided', () => {
        mockOkResponse({ message: 'Restored', name: 'snap-1', failed: false, indices: [] });

        restoreSnapshot('snap-1');
        expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
            body: JSON.stringify({ snapshotName: 'snap-1' }),
        }));
    });
});

describe('deleteSnapshot', () => {
    test('sends snapshotName in body', () => {
        const response = { deletedSnapshots: ['snap-1'] };
        mockOkResponse(response);

        const result = deleteSnapshot('snap-1');
        expect(result).toEqual(response);
        expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
            url: 'http://localhost:4848/repo/snapshot/delete',
            method: 'POST',
            body: JSON.stringify({ snapshotNames: ['snap-1'] }),
        }));
    });
});

describe('JWT auth integration', () => {
    test('uses Bearer header when JWT config is present', () => {
        mockGetJwtConfig.mockReturnValue({
            subject: 'user:system:datakit-service',
            keyId: 'my-key-id',
            privateKeyPath: '/path/to/key.pem',
            expirationSeconds: 30,
        });
        mockGenerateBearerToken.mockReturnValue('Bearer mock-jwt-token');
        mockOkResponse({ results: [] });

        listSnapshots();

        expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
            headers: { Authorization: 'Bearer mock-jwt-token' },
        }));
        const callArgs = mockedRequest.mock.calls[0][0];
        expect(callArgs).not.toHaveProperty('auth');
    });

    test('falls back to Basic Auth when JWT config is absent', () => {
        mockGetJwtConfig.mockReturnValue(undefined);
        mockOkResponse({ results: [] });

        listSnapshots();

        expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
            auth: { user: 'su', password: 'password' },
        }));
        expect(mockGenerateBearerToken).not.toHaveBeenCalled();
    });

    test('authHeader from request takes priority over JWT config', () => {
        mockGetJwtConfig.mockReturnValue({
            subject: 'user:system:datakit-service',
            keyId: 'my-key-id',
            privateKeyPath: '/path/to/key.pem',
            expirationSeconds: 30,
        });
        mockOkResponse({ results: [] });

        listSnapshots('Basic browser-auth');

        expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
            headers: { Authorization: 'Basic browser-auth' },
        }));
        expect(mockGetJwtConfig).not.toHaveBeenCalled();
        expect(mockGenerateBearerToken).not.toHaveBeenCalled();
    });
});
