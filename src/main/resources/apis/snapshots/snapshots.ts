import type { Request, Response } from '@enonic-types/core';
import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';
import {
    createSnapshot,
    deleteSnapshot,
    listSnapshots,
    restoreSnapshot,
} from '../../lib/management-api';

export function get(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const authHeader = req.headers?.Authorization;

    try {
        const snapshots = listSnapshots(authHeader);
        return jsonResponse(snapshots);
    } catch (e) {
        return errorResponse(502, String(e), 'MANAGEMENT_API_ERROR');
    }
}

export function post(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const authHeader = req.headers?.Authorization;
    const action = getParam(req, 'action');
    const body = req.body != null ? JSON.parse(req.body as string) : {};

    try {
        if (action === 'restore') {
            const snapshotName = body.snapshotName as string | undefined;
            if (snapshotName == null) {
                return errorResponse(400, 'snapshotName is required', 'VALIDATION_ERROR');
            }
            const repositoryId = body.repositoryId as string | undefined;
            const result = restoreSnapshot(snapshotName, repositoryId, authHeader);
            return jsonResponse(result);
        }

        const repositoryId = body.repositoryId as string | undefined;
        if (repositoryId == null) {
            return errorResponse(400, 'repositoryId is required', 'VALIDATION_ERROR');
        }
        const snapshot = createSnapshot(repositoryId, authHeader);
        return jsonResponse(snapshot, 201);
    } catch (e) {
        return errorResponse(502, String(e), 'MANAGEMENT_API_ERROR');
    }
}

function delete_(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const authHeader = req.headers?.Authorization;
    const snapshotName = getParam(req, 'snapshotName');
    if (snapshotName == null) {
        return errorResponse(400, 'snapshotName is required', 'VALIDATION_ERROR');
    }

    try {
        const result = deleteSnapshot(snapshotName, authHeader);
        return jsonResponse(result);
    } catch (e) {
        return errorResponse(502, String(e), 'MANAGEMENT_API_ERROR');
    }
}

export { delete_ as delete };
