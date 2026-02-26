import type { Request, Response } from '@enonic-types/core';
import { connect } from '/lib/xp/node';
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
