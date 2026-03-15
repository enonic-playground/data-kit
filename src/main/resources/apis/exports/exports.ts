import type { Request, Response } from '@enonic-types/core';
import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';
import {
    createExport,
    deleteExport,
    importExport,
    listExports,
} from '../../lib/exports';

const VALID_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,98}[A-Za-z0-9]$/;

export function get(_req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    try {
        const entries = listExports();
        return jsonResponse(entries);
    } catch (e) {
        return errorResponse(500, String(e), 'INTERNAL_ERROR');
    }
}

export function post(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const action = getParam(req, 'action');
    const body = req.body != null ? JSON.parse(req.body as string) : {};

    try {
        if (action === 'import') {
            const exportName = body.exportName as string | undefined;
            const repositoryId = body.repositoryId as string | undefined;
            const branch = body.branch as string | undefined;
            const targetNodePath = body.targetNodePath as string | undefined;
            if (exportName == null) {
                return errorResponse(400, 'exportName is required', 'VALIDATION_ERROR');
            }
            if (!VALID_NAME_PATTERN.test(exportName)) {
                return errorResponse(400, 'exportName contains invalid characters', 'VALIDATION_ERROR');
            }
            if (repositoryId == null) {
                return errorResponse(400, 'repositoryId is required', 'VALIDATION_ERROR');
            }
            if (branch == null) {
                return errorResponse(400, 'branch is required', 'VALIDATION_ERROR');
            }
            if (targetNodePath == null) {
                return errorResponse(400, 'targetNodePath is required', 'VALIDATION_ERROR');
            }
            const result = importExport({
                exportName,
                repositoryId,
                branch,
                targetNodePath,
                includeNodeIds: body.includeNodeIds as boolean | undefined,
                includePermissions: body.includePermissions as boolean | undefined,
            });
            return jsonResponse(result, 202);
        }

        const exportName = body.exportName as string | undefined;
        const repositoryId = body.repositoryId as string | undefined;
        const branch = body.branch as string | undefined;
        const nodePath = body.nodePath as string | undefined;
        if (exportName == null) {
            return errorResponse(400, 'exportName is required', 'VALIDATION_ERROR');
        }
        if (!VALID_NAME_PATTERN.test(exportName)) {
            return errorResponse(400, 'exportName contains invalid characters', 'VALIDATION_ERROR');
        }
        if (repositoryId == null) {
            return errorResponse(400, 'repositoryId is required', 'VALIDATION_ERROR');
        }
        if (branch == null) {
            return errorResponse(400, 'branch is required', 'VALIDATION_ERROR');
        }
        if (nodePath == null) {
            return errorResponse(400, 'nodePath is required', 'VALIDATION_ERROR');
        }
        const result = createExport({ exportName, repositoryId, branch, nodePath });
        return jsonResponse(result, 202);
    } catch (e) {
        return errorResponse(500, String(e), 'INTERNAL_ERROR');
    }
}

function delete_(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const name = getParam(req, 'name');
    if (name == null) {
        return errorResponse(400, 'name is required', 'VALIDATION_ERROR');
    }

    try {
        const success = deleteExport(name);
        if (!success) {
            return errorResponse(404, `Export '${name}' not found`, 'NOT_FOUND');
        }
        return jsonResponse({ success: true });
    } catch (e) {
        return errorResponse(500, String(e), 'INTERNAL_ERROR');
    }
}

export { delete_ as delete };
