import type { Request, Response } from '@enonic-types/core';
import { find } from '/lib/xp/auditlog';
import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';

const DEFAULT_COUNT = 25;

function parseIntParam(req: Request, name: string, fallback: number): number {
    const raw = getParam(req, name);
    if (raw == null) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function get(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const user = getParam(req, 'user');

    try {
        const result = find({
            start: parseIntParam(req, 'start', 0),
            count: parseIntParam(req, 'count', DEFAULT_COUNT),
            from: getParam(req, 'from'),
            to: getParam(req, 'to'),
            type: getParam(req, 'type'),
            source: getParam(req, 'source'),
            users: user != null ? [user] : undefined,
        });
        return jsonResponse(result);
    } catch (e) {
        return errorResponse(500, String(e), 'INTERNAL_ERROR');
    }
}
