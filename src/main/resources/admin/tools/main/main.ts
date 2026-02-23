import type { Request, Response } from '@enonic-types/core';
import { render } from '/lib/mustache';
import { getLauncherUrl, getToolUrl } from '/lib/xp/admin';
import { getUser } from '/lib/xp/auth';
import { assetUrl, serviceUrl } from '/lib/xp/portal';

type DataKitConfig = {
    appId: string;
    assetsUri: string;
    toolUri: string;
    apiUri: string;
    launcherUri: string;
    user: {
        key: string;
        displayName: string;
    } | null;
};

function buildConfig(): DataKitConfig {
    const currentUser = getUser();

    return {
        appId: app.name,
        assetsUri: assetUrl({ path: '' }),
        toolUri: getToolUrl(app.name, 'main'),
        apiUri: serviceUrl({ service: 'api', type: 'server' }),
        launcherUri: getLauncherUrl(),
        user: currentUser
            ? {
                  key: currentUser.key,
                  displayName: currentUser.displayName,
              }
            : null,
    };
}

export function get(_req: Request): Response {
    const view = resolve('./main.html');
    const config = buildConfig();

    return {
        contentType: 'text/html',
        body: render(view, {
            assetsUri: config.assetsUri,
            config: JSON.stringify(config),
        }),
    };
}
