import type { Request, Response } from '@enonic-types/core';
import { render } from '/lib/mustache';
import { getToolUrl } from '/lib/xp/admin';
import { connect } from '/lib/xp/node';
import { apiUrl } from '/lib/xp/portal';

import { getParam, requireAdmin } from '../../../lib/api';

const DEFAULT_REPOSITORY = 'com.enonic.cms.default';
const DEFAULT_BRANCH = 'draft';

//
// * Widget Controller
//

export function get(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const repositoryId = getParam(req, 'repository') ?? DEFAULT_REPOSITORY;
    const branch = getParam(req, 'branch') ?? DEFAULT_BRANCH;
    const contentId = getParam(req, 'contentId');

    const view = resolve('./export.html');
    const node = contentId != null ? connect({ repoId: repositoryId, branch }).get(contentId) : null;

    if (node == null) {
        return {
            contentType: 'text/html',
            body: render(view, {
                hasContent: false,
                repositoryId,
                branch,
            }),
        };
    }

    return {
        contentType: 'text/html',
        body: render(view, {
            hasContent: true,
            exportsApiUrl: apiUrl({ api: 'exports', type: 'server' }),
            dataKitExportsUrl: `${getToolUrl(app.name, 'main')}#/exports`,
            repositoryId,
            branch,
            nodePath: node._path,
            nodeName: node._name,
            defaultExportName: buildDefaultExportName(node._name),
        }),
    };
}

//
// * Helpers
//

function buildDefaultExportName(nodeName: string): string {
    const today = new Date().toISOString().slice(0, 10);
    const safe = nodeName.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
    return `${safe}-${today}`;
}
