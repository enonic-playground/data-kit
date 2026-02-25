import type { Request, Response } from '@enonic-types/core';
import { create, delete as deleteRepo, list } from '/lib/xp/repo';
import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';

type RepositoryDto = {
    id: string;
    branches: string[];
};

const PROTECTED_REPOS = ['system-repo', 'com.enonic.cms.default'];

const REPO_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,98}[a-z0-9]$/;

export function get(_req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const repos: RepositoryDto[] = list().map(repo => ({
        id: repo.id,
        branches: repo.branches,
    }));

    return jsonResponse(repos);
}

export function post(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const body = req.body != null ? JSON.parse(req.body as string) : {};
    const id = body.id as string | undefined;

    if (id == null || typeof id !== 'string') {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }

    if (!REPO_ID_PATTERN.test(id)) {
        return errorResponse(
            400,
            'Repository ID must be 3-100 characters: lowercase letters, digits, dots, hyphens',
            'VALIDATION_ERROR',
        );
    }

    const repo = create({ id });

    return jsonResponse({ id: repo.id, branches: repo.branches } satisfies RepositoryDto, 201);
}

function delete_(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const id = getParam(req, 'id');
    if (id == null) {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }

    if (PROTECTED_REPOS.indexOf(id) !== -1) {
        return errorResponse(403, `Repository '${id}' is protected and cannot be deleted`, 'PROTECTED_REPO');
    }

    const deleted = deleteRepo(id);
    if (!deleted) {
        return errorResponse(404, `Repository '${id}' not found`, 'NOT_FOUND');
    }

    return jsonResponse({ id, deleted });
}

export { delete_ as delete };
