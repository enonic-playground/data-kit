import type { Request, Response } from '@enonic-types/core';
import type { NodeCommit, NodeVersion, RepoConnection } from '@enonic-types/lib-node';
import { connect } from '/lib/xp/node';
import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';

//
// * Types
//

type NodeCommitDto = {
    id: string;
    message: string;
    committer: string;
    timestamp: string;
};

type NodeVersionDto = NodeVersion & {
    commit?: NodeCommitDto | null;
};

type VersionsResult = {
    total: number;
    count: number;
    cursor: string | null;
    activeVersionId: string | null;
    hits: NodeVersionDto[];
};

type SetActiveBody = {
    repoId?: string;
    branch?: string;
    key?: string;
    versionId?: string;
};

// ? setActiveVersion exists at runtime in XP 8 but is not in @enonic-types/lib-node@8.0.0-A3 yet.
//   Remove this shim when the types catch up.
type RepoConnectionWithSetActive = RepoConnection & {
    setActiveVersion: (params: { key: string; versionId: string }) => boolean;
};

const DEFAULT_COUNT = 25;

//
// * Helpers
//

function resolveCommit(
    repo: RepoConnection,
    commitId: string,
    cache: Record<string, NodeCommitDto | null>,
): NodeCommitDto | null {
    if (cache[commitId] !== undefined) return cache[commitId];

    let resolved: NodeCommitDto | null = null;
    try {
        const commit: NodeCommit | null = repo.getCommit({ id: commitId });
        if (commit != null) {
            resolved = {
                id: commit.id,
                message: commit.message,
                committer: commit.committer,
                timestamp: commit.timestamp,
            };
        }
    } catch (_e) {
        resolved = null;
    }
    cache[commitId] = resolved;
    return resolved;
}

//
// * GET — list versions
//

export function get(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const repoId = getParam(req, 'repoId');
    if (repoId == null) return errorResponse(400, 'repoId is required', 'VALIDATION_ERROR');

    const branch = getParam(req, 'branch');
    if (branch == null) return errorResponse(400, 'branch is required', 'VALIDATION_ERROR');

    const key = getParam(req, 'key');
    if (key == null) return errorResponse(400, 'key is required', 'VALIDATION_ERROR');

    const cursor = getParam(req, 'cursor');
    const countRaw = getParam(req, 'count');
    const parsedCount = countRaw != null ? Number.parseInt(countRaw, 10) : Number.NaN;
    const count = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : DEFAULT_COUNT;

    try {
        const repo = connect({ repoId, branch });

        const node = repo.get(key);
        if (node == null) return errorResponse(404, `Node '${key}' not found`, 'NOT_FOUND');

        const result = repo.getVersions({
            key,
            cursor: cursor ?? null,
            count,
        });

        const active = repo.getActiveVersion({ key });

        const commitCache: Record<string, NodeCommitDto | null> = {};
        const hits: NodeVersionDto[] = result.hits.map(v => {
            if (v.commitId == null) return v;
            return { ...v, commit: resolveCommit(repo, v.commitId, commitCache) };
        });

        return jsonResponse({
            total: result.total,
            count: result.count,
            cursor: result.cursor ?? null,
            activeVersionId: active?.versionId ?? null,
            hits,
        } satisfies VersionsResult);
    } catch (_e) {
        return errorResponse(500, 'Failed to list versions', 'INTERNAL_ERROR');
    }
}

//
// * PUT — set active version
//

export function put(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    let body: SetActiveBody;
    try {
        body = req.body != null ? (JSON.parse(req.body as string) as SetActiveBody) : {};
    } catch (_e) {
        return errorResponse(400, 'Invalid JSON body', 'VALIDATION_ERROR');
    }

    const { repoId, branch, key, versionId } = body;
    if (repoId == null) return errorResponse(400, 'repoId is required', 'VALIDATION_ERROR');
    if (branch == null) return errorResponse(400, 'branch is required', 'VALIDATION_ERROR');
    if (key == null) return errorResponse(400, 'key is required', 'VALIDATION_ERROR');
    if (versionId == null) return errorResponse(400, 'versionId is required', 'VALIDATION_ERROR');

    try {
        const repo = connect({ repoId, branch }) as RepoConnectionWithSetActive;

        const node = repo.get(key);
        if (node == null) return errorResponse(404, `Node '${key}' not found`, 'NOT_FOUND');

        const success = repo.setActiveVersion({ key, versionId });
        if (!success) return errorResponse(404, `Version '${versionId}' not found`, 'NOT_FOUND');

        return jsonResponse({ key, versionId, active: true });
    } catch (_e) {
        return errorResponse(500, 'Failed to set active version', 'INTERNAL_ERROR');
    }
}
