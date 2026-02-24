import type { Request, Response } from '@enonic-types/core';
import { getVersion } from '/lib/xp/admin';
import { jsonResponse, requireAdmin } from '../../lib/api';

type SystemInfo = {
    xpVersion: string;
    appVersion: string;
    appName: string;
};

export function get(_req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const info: SystemInfo = {
        xpVersion: getVersion(),
        appVersion: app.version,
        appName: app.name,
    };

    return jsonResponse(info);
}
