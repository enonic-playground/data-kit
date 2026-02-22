import type { Request, Response } from '@enonic-types/core';
import { render } from '/lib/mustache';
import { getHomeToolUrl, getToolUrl } from '/lib/xp/admin';
import { assetUrl } from '/lib/xp/portal';

export function get(_req: Request): Response {
    const view = resolve('./main.html');
    const params = {
        assetsUri: assetUrl({ path: '' }),
        toolUrl: getToolUrl(app.name, 'main'),
        adminUrl: getHomeToolUrl({ type: 'server' }),
    };
    return {
        contentType: 'text/html',
        body: render(view, params),
    };
}
