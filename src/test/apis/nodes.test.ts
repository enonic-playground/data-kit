import type { Request } from '@enonic-types/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('/lib/xp/auth', () => ({
    hasRole: vi.fn(() => true),
}));

vi.mock('/lib/xp/node', () => ({
    connect: vi.fn(),
}));

import { hasRole } from '/lib/xp/auth';
import { connect } from '/lib/xp/node';
import { get } from '../../main/resources/apis/nodes/nodes';

const mockedHasRole = vi.mocked(hasRole);
const mockedConnect = vi.mocked(connect);

function parseBody(response: { body?: string | object }) {
    return JSON.parse(response.body as string);
}

function createMockConnection(overrides: Record<string, unknown> = {}) {
    return {
        query: vi.fn().mockReturnValue({ total: 0, count: 0, hits: [] }),
        get: vi.fn().mockReturnValue([]),
        findChildren: vi.fn().mockReturnValue({ total: 0, count: 0, hits: [] }),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockedHasRole.mockReturnValue(true);
});

describe('GET /nodes', () => {
    test('returns child nodes for valid params', () => {
        const mockConn = createMockConnection({
            query: vi.fn().mockReturnValue({
                total: 2,
                count: 2,
                hits: [{ id: 'id-1', score: 1 }, { id: 'id-2', score: 1 }],
            }),
            get: vi.fn().mockReturnValue([
                {
                    _id: 'id-1',
                    _name: 'content',
                    _path: '/content',
                    _nodeType: 'default',
                    _ts: '2026-01-01T00:00:00Z',
                    _childOrder: '_name ASC',
                    _permissions: [],
                    _versionKey: 'v1',
                },
                {
                    _id: 'id-2',
                    _name: 'issues',
                    _path: '/issues',
                    _nodeType: 'default',
                    _ts: '2026-01-02T00:00:00Z',
                    _childOrder: '_name ASC',
                    _permissions: [],
                    _versionKey: 'v2',
                },
            ]),
            findChildren: vi.fn()
                .mockReturnValueOnce({ total: 3, count: 0, hits: [] })
                .mockReturnValueOnce({ total: 0, count: 0, hits: [] }),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = get({
            params: { repoId: 'my-repo', branch: 'master' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data.total).toBe(2);
        expect(body.data.nodes).toHaveLength(2);
        expect(body.data.nodes[0]).toEqual({
            _id: 'id-1',
            _name: 'content',
            _path: '/content',
            hasChildren: true,
            _nodeType: 'default',
            _ts: '2026-01-01T00:00:00Z',
        });
        expect(body.data.nodes[1].hasChildren).toBe(false);
        expect(mockedConnect).toHaveBeenCalledWith({ repoId: 'my-repo', branch: 'master' });
    });

    test('uses default parentPath / when omitted', () => {
        const mockConn = createMockConnection();
        mockedConnect.mockReturnValue(mockConn as never);

        get({
            params: { repoId: 'my-repo', branch: 'master' },
        } as unknown as Request);

        expect(mockConn.query).toHaveBeenCalledWith(
            expect.objectContaining({
                query: "_parentPath = '/'",
            }),
        );
    });

    test('uses provided parentPath', () => {
        const mockConn = createMockConnection();
        mockedConnect.mockReturnValue(mockConn as never);

        get({
            params: { repoId: 'my-repo', branch: 'master', parentPath: '/content' },
        } as unknown as Request);

        expect(mockConn.query).toHaveBeenCalledWith(
            expect.objectContaining({
                query: "_parentPath = '/content'",
            }),
        );
    });

    test('uses default start and count when omitted', () => {
        const mockConn = createMockConnection();
        mockedConnect.mockReturnValue(mockConn as never);

        get({
            params: { repoId: 'my-repo', branch: 'master' },
        } as unknown as Request);

        expect(mockConn.query).toHaveBeenCalledWith(
            expect.objectContaining({
                start: 0,
                count: 25,
            }),
        );
    });

    test('uses provided start and count', () => {
        const mockConn = createMockConnection();
        mockedConnect.mockReturnValue(mockConn as never);

        get({
            params: { repoId: 'my-repo', branch: 'master', start: '10', count: '5' },
        } as unknown as Request);

        expect(mockConn.query).toHaveBeenCalledWith(
            expect.objectContaining({
                start: 10,
                count: 5,
            }),
        );
    });

    test('returns 400 when repoId is missing', () => {
        const response = get({
            params: { branch: 'master' },
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 400 when branch is missing', () => {
        const response = get({
            params: { repoId: 'my-repo' },
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 403 for non-admin users', () => {
        mockedHasRole.mockReturnValue(false);
        const response = get({
            params: { repoId: 'my-repo', branch: 'master' },
        } as unknown as Request);
        expect(response.status).toBe(403);
    });

    test('handles empty result set', () => {
        const mockConn = createMockConnection();
        mockedConnect.mockReturnValue(mockConn as never);

        const response = get({
            params: { repoId: 'my-repo', branch: 'master' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data.nodes).toEqual([]);
        expect(body.data.total).toBe(0);
    });

    test('returns 500 when connection fails', () => {
        mockedConnect.mockImplementation(() => {
            throw new Error('Connection failed');
        });

        const response = get({
            params: { repoId: 'nonexistent', branch: 'master' },
        } as unknown as Request);
        expect(response.status).toBe(500);
        expect(parseBody(response).code).toBe('INTERNAL_ERROR');
    });

    test('handles single node result from get()', () => {
        const mockConn = createMockConnection({
            query: vi.fn().mockReturnValue({
                total: 1,
                count: 1,
                hits: [{ id: 'id-1', score: 1 }],
            }),
            get: vi.fn().mockReturnValue({
                _id: 'id-1',
                _name: 'content',
                _path: '/content',
                _nodeType: 'default',
                _ts: '2026-01-01T00:00:00Z',
                _childOrder: '_name ASC',
                _permissions: [],
                _versionKey: 'v1',
            }),
            findChildren: vi.fn().mockReturnValue({ total: 0, count: 0, hits: [] }),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = get({
            params: { repoId: 'my-repo', branch: 'master' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data.nodes).toHaveLength(1);
        expect(body.data.nodes[0]._name).toBe('content');
    });
});
