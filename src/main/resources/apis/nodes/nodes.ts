import type { Request, Response } from '@enonic-types/core';
import { connect } from '/lib/xp/node';
import { get as getRepo } from '/lib/xp/repo';
import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';

type NodeDto = {
    _id: string;
    _name: string;
    _path: string;
    hasChildren: boolean;
    _nodeType: string;
    _ts: string;
};

type NodesResult = {
    nodes: NodeDto[];
    total: number;
};

const DEFAULT_COUNT = 25;

function getNodeDetail(_req: Request, repoId: string, branch: string, key: string): Response {
    try {
        const repo = connect({ repoId, branch });
        const node = repo.get(key);

        if (node == null) {
            return errorResponse(404, `Node '${key}' not found`, 'NOT_FOUND');
        }

        return jsonResponse(node);
    } catch (_e) {
        return errorResponse(500, 'Failed to get node', 'INTERNAL_ERROR');
    }
}

function getNodeList(req: Request, repoId: string, branch: string): Response {
    const parentPath = getParam(req, 'parentPath') || '/';
    const start = parseInt(getParam(req, 'start') || '0', 10);
    const count = parseInt(getParam(req, 'count') || String(DEFAULT_COUNT), 10);
    const sort = getParam(req, 'sort') || '_name ASC';

    try {
        const repo = connect({ repoId, branch });

        const queryResult = repo.query({
            start,
            count,
            query: `_parentPath = '${parentPath}'`,
            sort,
        });

        if (queryResult.count === 0) {
            return jsonResponse({ nodes: [], total: queryResult.total } satisfies NodesResult);
        }

        const ids = [];
        for (let i = 0; i < queryResult.hits.length; i++) {
            ids.push(queryResult.hits[i].id);
        }

        const rawNodes = repo.get(ids);
        if (rawNodes == null) {
            return jsonResponse({ nodes: [], total: 0 } satisfies NodesResult);
        }

        const nodesArray = Array.isArray(rawNodes) ? rawNodes : [rawNodes];

        const nodes: NodeDto[] = [];
        for (let i = 0; i < nodesArray.length; i++) {
            const node = nodesArray[i];
            const children = repo.findChildren({
                parentKey: node._id,
                countOnly: true,
                count: 0,
            });

            nodes.push({
                _id: node._id,
                _name: node._name,
                _path: node._path,
                hasChildren: children.total > 0,
                _nodeType: node._nodeType,
                _ts: node._ts,
            });
        }

        return jsonResponse({ nodes, total: queryResult.total } satisfies NodesResult);
    } catch (_e) {
        return errorResponse(500, 'Failed to query nodes', 'INTERNAL_ERROR');
    }
}

export function get(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const repoId = getParam(req, 'repoId');
    if (repoId == null) {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }

    const branch = getParam(req, 'branch');
    if (branch == null) {
        return errorResponse(400, 'Branch is required', 'VALIDATION_ERROR');
    }

    const key = getParam(req, 'key');
    if (key != null) {
        return getNodeDetail(req, repoId, branch, key);
    }

    return getNodeList(req, repoId, branch);
}

//
// * POST — Create node / Push node
//

function createNode(req: Request): Response {
    const body = req.body != null ? JSON.parse(req.body as string) : {};
    const repoId = body.repoId as string | undefined;
    const branch = body.branch as string | undefined;
    const parentPath = body.parentPath as string | undefined;
    const name = body.name as string | undefined;
    const nodeType = body.nodeType as string | undefined;

    if (repoId == null) {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }
    if (branch == null) {
        return errorResponse(400, 'Branch is required', 'VALIDATION_ERROR');
    }
    if (name == null) {
        return errorResponse(400, 'Node name is required', 'VALIDATION_ERROR');
    }

    try {
        const repo = connect({ repoId, branch });
        const created = repo.create({
            _parentPath: parentPath || '/',
            _name: name,
            _nodeType: nodeType || 'default',
        });

        return jsonResponse(created, 201);
    } catch (_e) {
        return errorResponse(500, 'Failed to create node', 'INTERNAL_ERROR');
    }
}

function pushNode(req: Request): Response {
    const body = req.body != null ? JSON.parse(req.body as string) : {};
    const repoId = body.repoId as string | undefined;
    const branch = body.branch as string | undefined;
    const key = body.key as string | undefined;
    const target = body.target as string | undefined;
    const includeChildren = body.includeChildren as boolean | undefined;
    const resolve = body.resolve as boolean | undefined;

    if (repoId == null) {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }
    if (branch == null) {
        return errorResponse(400, 'Branch is required', 'VALIDATION_ERROR');
    }
    if (key == null) {
        return errorResponse(400, 'Node key is required', 'VALIDATION_ERROR');
    }
    if (target == null) {
        return errorResponse(400, 'Target branch is required', 'VALIDATION_ERROR');
    }

    try {
        const repo = connect({ repoId, branch });
        const result = repo.push({
            key,
            target,
            includeChildren: includeChildren ?? false,
            resolve: resolve ?? true,
        });

        return jsonResponse(result);
    } catch (_e) {
        return errorResponse(500, 'Failed to push node', 'INTERNAL_ERROR');
    }
}

function duplicateNode(req: Request): Response {
    const body = req.body != null ? JSON.parse(req.body as string) : {};
    const repoId = body.repoId as string | undefined;
    const branch = body.branch as string | undefined;
    const nodeId = body.nodeId as string | undefined;
    const name = body.name as string | undefined;
    const includeChildren = body.includeChildren as boolean | undefined;

    if (repoId == null) {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }
    if (branch == null) {
        return errorResponse(400, 'Branch is required', 'VALIDATION_ERROR');
    }
    if (nodeId == null) {
        return errorResponse(400, 'Node ID is required', 'VALIDATION_ERROR');
    }

    try {
        const repo = connect({ repoId, branch });
        const duplicated = repo.duplicate({
            nodeId,
            name: name || undefined,
            includeChildren: includeChildren ?? false,
        });

        return jsonResponse(duplicated, 201);
    } catch (_e) {
        return errorResponse(500, 'Failed to duplicate node', 'INTERNAL_ERROR');
    }
}

export function post(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const action = getParam(req, 'action');
    if (action === 'push') return pushNode(req);
    if (action === 'duplicate') return duplicateNode(req);

    return createNode(req);
}

//
// * PUT — Rename / Move node
//

function renameNode(req: Request): Response {
    const body = req.body != null ? JSON.parse(req.body as string) : {};
    const repoId = body.repoId as string | undefined;
    const branch = body.branch as string | undefined;
    const key = body.key as string | undefined;
    const newName = body.newName as string | undefined;

    if (repoId == null) {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }
    if (branch == null) {
        return errorResponse(400, 'Branch is required', 'VALIDATION_ERROR');
    }
    if (key == null) {
        return errorResponse(400, 'Node key is required', 'VALIDATION_ERROR');
    }
    if (newName == null) {
        return errorResponse(400, 'New name is required', 'VALIDATION_ERROR');
    }

    try {
        const repo = connect({ repoId, branch });
        const node = repo.get(key);
        if (node == null) {
            return errorResponse(404, `Node '${key}' not found`, 'NOT_FOUND');
        }
        if (node._path === '/') {
            return errorResponse(403, 'Root node cannot be renamed', 'PROTECTED_NODE');
        }

        repo.move({ source: key, target: newName });
        return jsonResponse({ success: true });
    } catch (_e) {
        return errorResponse(500, 'Failed to rename node', 'INTERNAL_ERROR');
    }
}

function moveNode(req: Request): Response {
    const body = req.body != null ? JSON.parse(req.body as string) : {};
    const repoId = body.repoId as string | undefined;
    const branch = body.branch as string | undefined;
    const key = body.key as string | undefined;
    const targetPath = body.targetPath as string | undefined;

    if (repoId == null) {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }
    if (branch == null) {
        return errorResponse(400, 'Branch is required', 'VALIDATION_ERROR');
    }
    if (key == null) {
        return errorResponse(400, 'Node key is required', 'VALIDATION_ERROR');
    }
    if (targetPath == null) {
        return errorResponse(400, 'Target path is required', 'VALIDATION_ERROR');
    }

    try {
        const repo = connect({ repoId, branch });
        const node = repo.get(key);
        if (node == null) {
            return errorResponse(404, `Node '${key}' not found`, 'NOT_FOUND');
        }
        if (node._path === '/') {
            return errorResponse(403, 'Root node cannot be moved', 'PROTECTED_NODE');
        }

        const targetNode = repo.get(targetPath);
        if (targetNode == null) {
            return errorResponse(404, `Target path '${targetPath}' not found`, 'NOT_FOUND');
        }

        repo.move({ source: key, target: targetPath });
        return jsonResponse({ success: true });
    } catch (_e) {
        return errorResponse(500, 'Failed to move node', 'INTERNAL_ERROR');
    }
}

export function put(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const action = getParam(req, 'action');
    if (action === 'rename') return renameNode(req);
    if (action === 'move') return moveNode(req);

    return errorResponse(400, 'Action parameter is required (rename or move)', 'VALIDATION_ERROR');
}

//
// * DELETE — Delete node
//

function delete_(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const repoId = getParam(req, 'repoId');
    if (repoId == null) {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }

    const branch = getParam(req, 'branch');
    if (branch == null) {
        return errorResponse(400, 'Branch is required', 'VALIDATION_ERROR');
    }

    const key = getParam(req, 'key');
    if (key == null) {
        return errorResponse(400, 'Node key is required', 'VALIDATION_ERROR');
    }

    const allBranches = getParam(req, 'allBranches') === 'true';

    try {
        const repo = connect({ repoId, branch });
        const node = repo.get(key);
        if (node == null) {
            return errorResponse(404, `Node '${key}' not found`, 'NOT_FOUND');
        }
        if (node._path === '/') {
            return errorResponse(403, 'Root node cannot be deleted', 'PROTECTED_NODE');
        }

        if (allBranches) {
            const repoInfo = getRepo(repoId);
            if (repoInfo == null) {
                return errorResponse(404, `Repository '${repoId}' not found`, 'NOT_FOUND');
            }

            const deleted: string[] = [];
            const failed: string[] = [];
            for (let i = 0; i < repoInfo.branches.length; i++) {
                const branchId = repoInfo.branches[i];
                try {
                    const branchRepo = connect({ repoId, branch: branchId });
                    const branchNode = branchRepo.get(key);
                    if (branchNode != null) {
                        branchRepo.delete(key);
                        deleted.push(branchId);
                    }
                } catch (_e) {
                    failed.push(branchId);
                }
            }

            return jsonResponse({ key, deleted: true, branches: { deleted, failed } });
        }

        repo.delete(key);
        return jsonResponse({ key, deleted: true });
    } catch (_e) {
        return errorResponse(500, 'Failed to delete node', 'INTERNAL_ERROR');
    }
}

export { delete_ as delete };
