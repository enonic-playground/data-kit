import type { Request, Response } from '@enonic-types/core';
import { createBranch, deleteBranch, get as getRepo } from '/lib/xp/repo';
import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';

type BranchDto = {
    id: string;
};

const PROTECTED_BRANCHES = ['master'];

const BRANCH_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,98}[a-z0-9]$/;

export function get(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const repoId = getParam(req, 'repoId');
    if (repoId == null) {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }

    try {
        const repo = getRepo(repoId);
        if (repo == null) {
            return errorResponse(404, `Repository '${repoId}' not found`, 'NOT_FOUND');
        }

        const branches: BranchDto[] = [];
        for (let i = 0; i < repo.branches.length; i++) {
            branches.push({ id: repo.branches[i] });
        }

        return jsonResponse(branches);
    } catch (_e) {
        return errorResponse(404, `Repository '${repoId}' not found`, 'NOT_FOUND');
    }
}

export function post(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const body = req.body != null ? JSON.parse(req.body as string) : {};
    const repoId = body.repoId as string | undefined;
    const branchId = body.branchId as string | undefined;

    if (repoId == null || typeof repoId !== 'string') {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }

    if (branchId == null || typeof branchId !== 'string') {
        return errorResponse(400, 'Branch ID is required', 'VALIDATION_ERROR');
    }

    if (!BRANCH_ID_PATTERN.test(branchId)) {
        return errorResponse(
            400,
            'Branch ID must be 2-100 characters: lowercase letters, digits, dots, hyphens',
            'VALIDATION_ERROR',
        );
    }

    try {
        const result = createBranch({ repoId, branchId });
        return jsonResponse({ id: result.id } satisfies BranchDto, 201);
    } catch (_e) {
        return errorResponse(409, `Branch '${branchId}' already exists or repository not found`, 'CONFLICT');
    }
}

function delete_(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const repoId = getParam(req, 'repoId');
    const branchId = getParam(req, 'branchId');

    if (repoId == null) {
        return errorResponse(400, 'Repository ID is required', 'VALIDATION_ERROR');
    }

    if (branchId == null) {
        return errorResponse(400, 'Branch ID is required', 'VALIDATION_ERROR');
    }

    if (PROTECTED_BRANCHES.indexOf(branchId) !== -1) {
        return errorResponse(403, `Branch '${branchId}' is protected and cannot be deleted`, 'PROTECTED_BRANCH');
    }

    try {
        deleteBranch({ repoId, branchId });
        return jsonResponse({ id: branchId, deleted: true });
    } catch (_e) {
        return errorResponse(404, `Branch '${branchId}' not found`, 'NOT_FOUND');
    }
}

export { delete_ as delete };
