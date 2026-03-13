import type { Request, Response } from '@enonic-types/core';
import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';
import {
    createDump,
    deleteDump,
    listDumps,
    loadDump,
    upgradeDump,
} from '../../lib/dumps';

export function get(_req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    try {
        const dumps = listDumps();
        return jsonResponse(dumps);
    } catch (e) {
        return errorResponse(500, String(e), 'INTERNAL_ERROR');
    }
}

export function post(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const authHeader = req.headers?.Authorization;
    const action = getParam(req, 'action');
    const body = req.body != null ? JSON.parse(req.body as string) : {};

    try {
        if (action === 'load') {
            const name = body.name as string | undefined;
            if (name == null) {
                return errorResponse(400, 'name is required', 'VALIDATION_ERROR');
            }
            const result = loadDump(
                { name, upgrade: body.upgrade as boolean | undefined, archive: body.archive as boolean | undefined },
                authHeader,
            );
            return jsonResponse(result, 202);
        }

        if (action === 'upgrade') {
            const name = body.name as string | undefined;
            if (name == null) {
                return errorResponse(400, 'name is required', 'VALIDATION_ERROR');
            }
            const result = upgradeDump(name, authHeader);
            return jsonResponse(result, 202);
        }

        const name = body.name as string | undefined;
        if (name == null) {
            return errorResponse(400, 'name is required', 'VALIDATION_ERROR');
        }
        const result = createDump(
            {
                name,
                includeVersions: body.includeVersions as boolean | undefined,
                maxAge: body.maxAge as number | undefined,
                maxVersions: body.maxVersions as number | undefined,
            },
            authHeader,
        );
        return jsonResponse(result, 202);
    } catch (e) {
        return errorResponse(502, String(e), 'MANAGEMENT_API_ERROR');
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
        const success = deleteDump(name);
        if (!success) {
            return errorResponse(404, `Dump '${name}' not found`, 'NOT_FOUND');
        }
        return jsonResponse({ success: true });
    } catch (e) {
        return errorResponse(500, String(e), 'INTERNAL_ERROR');
    }
}

export { delete_ as delete };
