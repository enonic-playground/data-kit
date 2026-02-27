import type { PrincipalKey, Request, Response } from '@enonic-types/core';
import { connect, multiRepoConnect } from '/lib/xp/node';
import { list } from '/lib/xp/repo';
import { errorResponse, jsonResponse, requireAdmin } from '../../lib/api';

type SearchHitDto = {
    _id: string;
    _score: number;
    _repoId: string;
    _branch: string;
    _name?: string;
    _path?: string;
    _nodeType?: string;
};

type SearchResult = {
    hits: SearchHitDto[];
    total: number;
    executionTimeMs: number;
};

type SearchBody = {
    query: string;
    repoId?: string;
    branch?: string;
    start?: number;
    count?: number;
    sort?: string;
};

const DEFAULT_COUNT = 25;

function querySingleRepo(
    repoId: string,
    branch: string,
    query: string,
    start: number,
    count: number,
    sort: string,
): SearchResult {
    const startTime = Date.now();

    const repo = connect({ repoId, branch });
    const queryResult = repo.query({ start, count, query, sort });

    const hits: SearchHitDto[] = [];

    if (queryResult.count > 0) {
        const ids: string[] = [];
        for (let i = 0; i < queryResult.hits.length; i++) {
            ids.push(queryResult.hits[i].id);
        }

        const rawNodes = repo.get(ids);
        const nodesArray = rawNodes == null ? [] : Array.isArray(rawNodes) ? rawNodes : [rawNodes];

        for (let i = 0; i < queryResult.hits.length; i++) {
            const hit = queryResult.hits[i];
            const node = nodesArray[i];
            hits.push({
                _id: hit.id,
                _score: hit.score,
                _repoId: repoId,
                _branch: branch,
                _name: node != null ? node._name : undefined,
                _path: node != null ? node._path : undefined,
                _nodeType: node != null ? node._nodeType : undefined,
            });
        }
    }

    return {
        hits,
        total: queryResult.total,
        executionTimeMs: Date.now() - startTime,
    };
}

function queryAllRepos(
    query: string,
    start: number,
    count: number,
    sort: string,
): SearchResult {
    const startTime = Date.now();

    const repos = list();
    const sources: Array<{ repoId: string; branch: string; principals: PrincipalKey[] }> = [];

    for (let i = 0; i < repos.length; i++) {
        const repo = repos[i];
        for (let j = 0; j < repo.branches.length; j++) {
            sources.push({
                repoId: repo.id,
                branch: repo.branches[j],
                principals: ['role:system.admin'],
            });
        }
    }

    if (sources.length === 0) {
        return { hits: [], total: 0, executionTimeMs: Date.now() - startTime };
    }

    const connection = multiRepoConnect({ sources });
    const queryResult = connection.query({ start, count, query, sort });

    const hits: SearchHitDto[] = [];

    for (let i = 0; i < queryResult.hits.length; i++) {
        const hit = queryResult.hits[i];
        hits.push({
            _id: hit.id,
            _score: hit.score,
            _repoId: hit.repoId,
            _branch: hit.branch,
        });
    }

    // Enrich hits with node metadata by grouping by repo+branch
    const groups: Record<string, { repoId: string; branch: string; indices: number[]; ids: string[] }> = {};
    for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        const groupKey = `${h._repoId}::${h._branch}`;
        if (groups[groupKey] == null) {
            groups[groupKey] = { repoId: h._repoId, branch: h._branch, indices: [], ids: [] };
        }
        groups[groupKey].indices.push(i);
        groups[groupKey].ids.push(h._id);
    }

    const groupKeys = Object.keys(groups);
    for (let i = 0; i < groupKeys.length; i++) {
        const group = groups[groupKeys[i]];
        try {
            const conn = connect({ repoId: group.repoId, branch: group.branch });
            const rawNodes = conn.get(group.ids);
            const nodesArray = rawNodes == null ? [] : Array.isArray(rawNodes) ? rawNodes : [rawNodes];

            for (let j = 0; j < group.indices.length; j++) {
                const idx = group.indices[j];
                const node = nodesArray[j];
                if (node != null) {
                    hits[idx]._name = node._name;
                    hits[idx]._path = node._path;
                    hits[idx]._nodeType = node._nodeType;
                }
            }
        } catch (_e) {
            // Skip enrichment for inaccessible repos
        }
    }

    return {
        hits,
        total: queryResult.total,
        executionTimeMs: Date.now() - startTime,
    };
}

export function post(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    let body: SearchBody;
    try {
        body = req.body != null ? JSON.parse(req.body as string) : {};
    } catch (_e) {
        return errorResponse(400, 'Invalid JSON body', 'VALIDATION_ERROR');
    }

    const query = body.query;
    if (query == null || typeof query !== 'string' || query.trim() === '') {
        return errorResponse(400, 'Query is required', 'VALIDATION_ERROR');
    }

    const start = typeof body.start === 'number' ? body.start : 0;
    const count = typeof body.count === 'number' ? body.count : DEFAULT_COUNT;
    const sort = typeof body.sort === 'string' && body.sort.trim() !== '' ? body.sort : '_score DESC';

    try {
        let result: SearchResult;

        if (body.repoId != null && body.branch != null) {
            result = querySingleRepo(body.repoId, body.branch, query, start, count, sort);
        } else {
            result = queryAllRepos(query, start, count, sort);
        }

        return jsonResponse(result);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);

        if (message.indexOf('ParseException') !== -1 || message.indexOf('parse') !== -1) {
            return errorResponse(400, `Invalid NoQL syntax: ${message}`, 'QUERY_ERROR');
        }

        return errorResponse(500, `Search failed: ${message}`, 'INTERNAL_ERROR');
    }
}
