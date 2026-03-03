import type { Request } from '@enonic-types/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('/lib/xp/auth', () => ({
    hasRole: vi.fn(() => true),
}));

vi.mock('/lib/xp/node', () => ({
    connect: vi.fn(),
}));

vi.mock('/lib/xp/repo', () => ({
    get: vi.fn(),
}));

import { hasRole } from '/lib/xp/auth';
import { connect } from '/lib/xp/node';
import { get as getRepo } from '/lib/xp/repo';
import { delete as deleteHandler, get, post, put } from '../../main/resources/apis/nodes/nodes';

const mockedHasRole = vi.mocked(hasRole);
const mockedConnect = vi.mocked(connect);
const mockedGetRepo = vi.mocked(getRepo);

function parseBody(response: { body?: string | object }) {
    return JSON.parse(response.body as string);
}

function createMockConnection(overrides: Record<string, unknown> = {}) {
    return {
        query: vi.fn().mockReturnValue({ total: 0, count: 0, hits: [] }),
        get: vi.fn().mockReturnValue([]),
        findChildren: vi.fn().mockReturnValue({ total: 0, count: 0, hits: [] }),
        create: vi.fn().mockReturnValue({ _id: 'new-id', _name: 'new-node', _path: '/new-node' }),
        push: vi.fn().mockReturnValue({ success: ['id-1'], failed: [], deleted: [] }),
        move: vi.fn().mockReturnValue(true),
        delete: vi.fn().mockReturnValue(['id-1']),
        duplicate: vi.fn().mockReturnValue({ _id: 'dup-id', _name: 'node-copy', _path: '/node-copy' }),
        exists: vi.fn().mockReturnValue(true),
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

describe('GET /nodes?key=', () => {
    test('returns full node when key param is provided', () => {
        const fullNode = {
            _id: 'id-1',
            _name: 'content',
            _path: '/content',
            _nodeType: 'default',
            _ts: '2026-01-01T00:00:00Z',
            _childOrder: '_name ASC',
            _state: 'DEFAULT',
            _versionKey: 'v1',
            _permissions: [
                { principal: 'role:system.admin', allow: ['READ', 'CREATE', 'MODIFY', 'DELETE'], deny: [] },
            ],
            title: 'My Content',
            data: { count: 42 },
        };
        const mockConn = createMockConnection({
            get: vi.fn().mockReturnValue(fullNode),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = get({
            params: { repoId: 'my-repo', branch: 'master', key: 'id-1' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual(fullNode);
        expect(mockConn.get).toHaveBeenCalledWith('id-1');
        expect(mockConn.query).not.toHaveBeenCalled();
    });

    test('returns 404 when node not found', () => {
        const mockConn = createMockConnection({
            get: vi.fn().mockReturnValue(null),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = get({
            params: { repoId: 'my-repo', branch: 'master', key: 'nonexistent' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(404);
        expect(body.code).toBe('NOT_FOUND');
    });

    test('returns 400 when repoId is missing', () => {
        const response = get({
            params: { branch: 'master', key: 'id-1' },
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 400 when branch is missing', () => {
        const response = get({
            params: { repoId: 'my-repo', key: 'id-1' },
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 403 for non-admin users', () => {
        mockedHasRole.mockReturnValue(false);
        const response = get({
            params: { repoId: 'my-repo', branch: 'master', key: 'id-1' },
        } as unknown as Request);
        expect(response.status).toBe(403);
    });

    test('returns 500 when connection fails', () => {
        mockedConnect.mockImplementation(() => {
            throw new Error('Connection failed');
        });

        const response = get({
            params: { repoId: 'my-repo', branch: 'master', key: 'id-1' },
        } as unknown as Request);
        expect(response.status).toBe(500);
        expect(parseBody(response).code).toBe('INTERNAL_ERROR');
    });
});

//
// * POST — Create node
//

describe('POST /nodes (create)', () => {
    test('creates a node with valid params', () => {
        const createdNode = {
            _id: 'new-id',
            _name: 'my-node',
            _path: '/my-node',
            _nodeType: 'default',
        };
        const mockConn = createMockConnection({
            create: vi.fn().mockReturnValue(createdNode),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = post({
            params: {},
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                parentPath: '/',
                name: 'my-node',
            }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(201);
        expect(body.data).toEqual(createdNode);
        expect(mockConn.create).toHaveBeenCalledWith({
            _parentPath: '/',
            _name: 'my-node',
            _nodeType: 'default',
        });
    });

    test('creates a node with custom nodeType', () => {
        const mockConn = createMockConnection();
        mockedConnect.mockReturnValue(mockConn as never);

        post({
            params: {},
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                parentPath: '/content',
                name: 'my-node',
                nodeType: 'custom-type',
            }),
        } as unknown as Request);

        expect(mockConn.create).toHaveBeenCalledWith({
            _parentPath: '/content',
            _name: 'my-node',
            _nodeType: 'custom-type',
        });
    });

    test('returns 400 when name is missing', () => {
        const response = post({
            params: {},
            body: JSON.stringify({ repoId: 'my-repo', branch: 'master' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 400 when repoId is missing', () => {
        const response = post({
            params: {},
            body: JSON.stringify({ branch: 'master', name: 'test' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 403 for non-admin users', () => {
        mockedHasRole.mockReturnValue(false);
        const response = post({
            params: {},
            body: JSON.stringify({ repoId: 'my-repo', branch: 'master', name: 'test' }),
        } as unknown as Request);
        expect(response.status).toBe(403);
    });
});

//
// * POST ?action=duplicate
//

describe('POST /nodes?action=duplicate', () => {
    test('duplicates a node', () => {
        const duplicated = {
            _id: 'dup-id',
            _name: 'my-node-copy',
            _path: '/my-node-copy',
            _nodeType: 'default',
        };
        const mockConn = createMockConnection({
            duplicate: vi.fn().mockReturnValue(duplicated),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = post({
            params: { action: 'duplicate' },
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                nodeId: 'id-1',
            }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(201);
        expect(body.data).toEqual(duplicated);
        expect(mockConn.duplicate).toHaveBeenCalledWith({
            nodeId: 'id-1',
            name: undefined,
            includeChildren: false,
        });
    });

    test('duplicates a node with custom name', () => {
        const mockConn = createMockConnection({
            duplicate: vi.fn().mockReturnValue({ _id: 'dup-id', _name: 'custom-copy' }),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        post({
            params: { action: 'duplicate' },
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                nodeId: 'id-1',
                name: 'custom-copy',
                includeChildren: true,
            }),
        } as unknown as Request);

        expect(mockConn.duplicate).toHaveBeenCalledWith({
            nodeId: 'id-1',
            name: 'custom-copy',
            includeChildren: true,
        });
    });

    test('returns 400 when nodeId is missing', () => {
        const response = post({
            params: { action: 'duplicate' },
            body: JSON.stringify({ repoId: 'my-repo', branch: 'master' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 403 for non-admin users', () => {
        mockedHasRole.mockReturnValue(false);
        const response = post({
            params: { action: 'duplicate' },
            body: JSON.stringify({ repoId: 'my-repo', branch: 'master', nodeId: 'id-1' }),
        } as unknown as Request);
        expect(response.status).toBe(403);
    });
});

//
// * POST ?action=push
//

describe('POST /nodes?action=push', () => {
    test('pushes a node to target branch', () => {
        const pushResult = { success: ['id-1'], failed: [], deleted: [] };
        const mockConn = createMockConnection({
            push: vi.fn().mockReturnValue(pushResult),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = post({
            params: { action: 'push' },
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                key: 'id-1',
                target: 'draft',
            }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual(pushResult);
        expect(mockConn.push).toHaveBeenCalledWith({
            key: 'id-1',
            target: 'draft',
            includeChildren: false,
            resolve: true,
        });
    });

    test('returns 400 when target branch is missing', () => {
        const response = post({
            params: { action: 'push' },
            body: JSON.stringify({ repoId: 'my-repo', branch: 'master', key: 'id-1' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 400 when key is missing', () => {
        const response = post({
            params: { action: 'push' },
            body: JSON.stringify({ repoId: 'my-repo', branch: 'master', target: 'draft' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });
});

//
// * PUT ?action=rename
//

describe('PUT /nodes?action=rename', () => {
    test('renames a node', () => {
        const mockConn = createMockConnection({
            get: vi.fn().mockReturnValue({ _id: 'id-1', _path: '/content', _name: 'content' }),
            move: vi.fn().mockReturnValue(true),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = put({
            params: { action: 'rename' },
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                key: 'id-1',
                newName: 'renamed-content',
            }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data.success).toBe(true);
        expect(mockConn.move).toHaveBeenCalledWith({
            source: 'id-1',
            target: 'renamed-content',
        });
    });

    test('returns 400 when newName is missing', () => {
        const response = put({
            params: { action: 'rename' },
            body: JSON.stringify({ repoId: 'my-repo', branch: 'master', key: 'id-1' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 403 for root node', () => {
        const mockConn = createMockConnection({
            get: vi.fn().mockReturnValue({ _id: 'root-id', _path: '/', _name: '' }),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = put({
            params: { action: 'rename' },
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                key: 'root-id',
                newName: 'new-root',
            }),
        } as unknown as Request);

        expect(response.status).toBe(403);
        expect(parseBody(response).code).toBe('PROTECTED_NODE');
    });

    test('returns 404 when node not found', () => {
        const mockConn = createMockConnection({
            get: vi.fn().mockReturnValue(null),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = put({
            params: { action: 'rename' },
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                key: 'nonexistent',
                newName: 'new-name',
            }),
        } as unknown as Request);

        expect(response.status).toBe(404);
        expect(parseBody(response).code).toBe('NOT_FOUND');
    });

    test('returns 403 for non-admin users', () => {
        mockedHasRole.mockReturnValue(false);
        const response = put({
            params: { action: 'rename' },
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                key: 'id-1',
                newName: 'new-name',
            }),
        } as unknown as Request);
        expect(response.status).toBe(403);
    });
});

//
// * PUT ?action=move
//

describe('PUT /nodes?action=move', () => {
    test('moves a node to target path', () => {
        const mockConn = createMockConnection({
            get: vi.fn()
                .mockReturnValueOnce({ _id: 'id-1', _path: '/content', _name: 'content' })
                .mockReturnValueOnce({ _id: 'target-id', _path: '/archive', _name: 'archive' }),
            move: vi.fn().mockReturnValue(true),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = put({
            params: { action: 'move' },
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                key: 'id-1',
                targetPath: '/archive',
            }),
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data.success).toBe(true);
        expect(mockConn.move).toHaveBeenCalledWith({
            source: 'id-1',
            target: '/archive',
        });
    });

    test('returns 400 when targetPath is missing', () => {
        const response = put({
            params: { action: 'move' },
            body: JSON.stringify({ repoId: 'my-repo', branch: 'master', key: 'id-1' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 404 when target path does not exist', () => {
        const mockConn = createMockConnection({
            get: vi.fn()
                .mockReturnValueOnce({ _id: 'id-1', _path: '/content', _name: 'content' })
                .mockReturnValueOnce(null),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = put({
            params: { action: 'move' },
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                key: 'id-1',
                targetPath: '/nonexistent',
            }),
        } as unknown as Request);

        expect(response.status).toBe(404);
    });

    test('returns 403 for root node', () => {
        const mockConn = createMockConnection({
            get: vi.fn().mockReturnValue({ _id: 'root-id', _path: '/', _name: '' }),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = put({
            params: { action: 'move' },
            body: JSON.stringify({
                repoId: 'my-repo',
                branch: 'master',
                key: 'root-id',
                targetPath: '/somewhere',
            }),
        } as unknown as Request);

        expect(response.status).toBe(403);
        expect(parseBody(response).code).toBe('PROTECTED_NODE');
    });
});

//
// * PUT — invalid action
//

describe('PUT /nodes (no action)', () => {
    test('returns 400 when action is missing', () => {
        const response = put({
            params: {},
            body: JSON.stringify({ repoId: 'my-repo', branch: 'master', key: 'id-1' }),
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });
});

//
// * DELETE
//

describe('DELETE /nodes', () => {
    test('deletes a node', () => {
        const mockConn = createMockConnection({
            get: vi.fn().mockReturnValue({ _id: 'id-1', _path: '/content', _name: 'content' }),
            delete: vi.fn().mockReturnValue(['id-1']),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = deleteHandler({
            params: { repoId: 'my-repo', branch: 'master', key: 'id-1' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data.key).toBe('id-1');
        expect(body.data.deleted).toBe(true);
        expect(mockConn.delete).toHaveBeenCalledWith('id-1');
    });

    test('returns 400 when key is missing', () => {
        const response = deleteHandler({
            params: { repoId: 'my-repo', branch: 'master' },
        } as unknown as Request);
        expect(response.status).toBe(400);
        expect(parseBody(response).code).toBe('VALIDATION_ERROR');
    });

    test('returns 403 for root node', () => {
        const mockConn = createMockConnection({
            get: vi.fn().mockReturnValue({ _id: 'root-id', _path: '/', _name: '' }),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = deleteHandler({
            params: { repoId: 'my-repo', branch: 'master', key: 'root-id' },
        } as unknown as Request);

        expect(response.status).toBe(403);
        expect(parseBody(response).code).toBe('PROTECTED_NODE');
    });

    test('returns 404 when node not found', () => {
        const mockConn = createMockConnection({
            get: vi.fn().mockReturnValue(null),
        });
        mockedConnect.mockReturnValue(mockConn as never);

        const response = deleteHandler({
            params: { repoId: 'my-repo', branch: 'master', key: 'nonexistent' },
        } as unknown as Request);

        expect(response.status).toBe(404);
        expect(parseBody(response).code).toBe('NOT_FOUND');
    });

    test('returns 403 for non-admin users', () => {
        mockedHasRole.mockReturnValue(false);
        const response = deleteHandler({
            params: { repoId: 'my-repo', branch: 'master', key: 'id-1' },
        } as unknown as Request);
        expect(response.status).toBe(403);
    });

    test('returns 500 when delete fails', () => {
        mockedConnect.mockImplementation(() => {
            throw new Error('Connection failed');
        });

        const response = deleteHandler({
            params: { repoId: 'my-repo', branch: 'master', key: 'id-1' },
        } as unknown as Request);
        expect(response.status).toBe(500);
        expect(parseBody(response).code).toBe('INTERNAL_ERROR');
    });

    test('deletes from all branches when allBranches=true', () => {
        const mockConn = createMockConnection({
            get: vi.fn().mockReturnValue({ _id: 'id-1', _path: '/content', _name: 'content' }),
            delete: vi.fn().mockReturnValue(['id-1']),
        });
        mockedConnect.mockReturnValue(mockConn as never);
        mockedGetRepo.mockReturnValue({ id: 'my-repo', branches: ['master', 'draft'] } as never);

        const response = deleteHandler({
            params: { repoId: 'my-repo', branch: 'master', key: 'id-1', allBranches: 'true' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data.deleted).toBe(true);
        expect(body.data.branches.deleted).toEqual(['master', 'draft']);
        expect(mockedConnect).toHaveBeenCalledTimes(3);
    });

    test('returns 404 when repo not found for allBranches delete', () => {
        const mockConn = createMockConnection({
            get: vi.fn().mockReturnValue({ _id: 'id-1', _path: '/content', _name: 'content' }),
        });
        mockedConnect.mockReturnValue(mockConn as never);
        mockedGetRepo.mockReturnValue(null as never);

        const response = deleteHandler({
            params: { repoId: 'missing-repo', branch: 'master', key: 'id-1', allBranches: 'true' },
        } as unknown as Request);

        expect(response.status).toBe(404);
        expect(parseBody(response).code).toBe('NOT_FOUND');
    });

    test('skips branches where node does not exist', () => {
        let callCount = 0;
        mockedConnect.mockImplementation(() => {
            callCount++;
            if (callCount <= 1) {
                return createMockConnection({
                    get: vi.fn().mockReturnValue({ _id: 'id-1', _path: '/content', _name: 'content' }),
                    delete: vi.fn().mockReturnValue(['id-1']),
                }) as never;
            }
            if (callCount === 2) {
                return createMockConnection({
                    get: vi.fn().mockReturnValue({ _id: 'id-1', _path: '/content', _name: 'content' }),
                    delete: vi.fn().mockReturnValue(['id-1']),
                }) as never;
            }
            return createMockConnection({
                get: vi.fn().mockReturnValue(null),
            }) as never;
        });
        mockedGetRepo.mockReturnValue({ id: 'my-repo', branches: ['master', 'draft'] } as never);

        const response = deleteHandler({
            params: { repoId: 'my-repo', branch: 'master', key: 'id-1', allBranches: 'true' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data.branches.deleted).toContain('master');
    });
});
