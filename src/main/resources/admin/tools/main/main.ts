import type { Request, Response } from '@enonic-types/core';
import { render } from '/lib/mustache';
import { extensionUrl, getToolUrl } from '/lib/xp/admin';
import { getUser } from '/lib/xp/auth';
import { apiUrl, assetUrl } from '/lib/xp/portal';

type DataKitConfig = {
    appId: string;
    assetsUri: string;
    toolUri: string;
    apiUris: {
        system: string;
        repositories: string;
        branches: string;
        nodes: string;
        search: string;
        binary: string;
        snapshots: string;
        dumps: string;
        exports: string;
        tasks: string;
        events: string;
    };
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
        apiUris: {
            system: apiUrl({ api: 'system', type: 'server' }),
            repositories: apiUrl({ api: 'repositories', type: 'server' }),
            branches: apiUrl({ api: 'branches', type: 'server' }),
            nodes: apiUrl({ api: 'nodes', type: 'server' }),
            search: apiUrl({ api: 'search', type: 'server' }),
            binary: apiUrl({ api: 'binary', type: 'server' }),
            snapshots: apiUrl({ api: 'snapshots', type: 'server' }),
            dumps: apiUrl({ api: 'dumps', type: 'server' }),
            exports: apiUrl({ api: 'exports', type: 'server' }),
            tasks: apiUrl({ api: 'tasks', type: 'server' }),
            events: apiUrl({ api: 'events', type: 'websocket' }),
        },
        launcherUri: extensionUrl({
            application: 'com.enonic.xp.app.main',
            extension: 'launcher',
        }),
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
