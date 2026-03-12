import type { HttpRequestOptions, HttpResponse } from '/lib/http-client';
import { request } from '/lib/http-client';
import { generateBearerToken, getJwtConfig } from './jwt';

//
// * Types
//

type ManagementApiCredentials = {
    user: string;
    password: string;
};

type ManagementApiRequestOptions = {
    method?: string;
    body?: unknown;
    authHeader?: string;
};

export type ManagementApiSnapshot = {
    name: string;
    reason: string;
    timestamp: string;
    state: string;
    indices: string[];
};

type ListSnapshotsResponse = {
    results: ManagementApiSnapshot[];
};

type RestoreSnapshotResponse = {
    message: string;
    name: string;
    failed: boolean;
    indices: string[];
};

type DeleteSnapshotsResponse = {
    deletedSnapshots: string[];
};

//
// * Config
//

export function getManagementApiUrl(): string {
    return app.config['managementApi.url'] ?? 'http://localhost:4848';
}

export function getManagementApiCredentials(): ManagementApiCredentials {
    const user = app.config['managementApi.user'];
    const password = app.config['managementApi.password'];

    if (user == null || password == null) {
        throw new Error(
            'Management API credentials not configured. ' +
            'Either log in with HTTP Basic Auth or create $XP_HOME/config/com.enonic.app.datakit.cfg ' +
            'with managementApi.authMethod=jwt (recommended) or managementApi.user and managementApi.password',
        );
    }

    return { user, password };
}

//
// * Request
//

function managementApiRequest<T>(path: string, options?: ManagementApiRequestOptions): T {
    const url = getManagementApiUrl();
    const method = (options?.method ?? 'GET') as HttpRequestOptions['method'];

    const requestParams: HttpRequestOptions = {
        url: `${url}/${path}`,
        method,
        contentType: 'application/json',
        connectionTimeout: 5000,
        readTimeout: 30000,
    };

    // ? Forward the browser's Authorization header if available, then try JWT, then fall back to Basic Auth
    if (options?.authHeader != null) {
        requestParams.headers = { Authorization: options.authHeader };
    } else {
        const jwtConfig = getJwtConfig();
        if (jwtConfig != null) {
            requestParams.headers = { Authorization: generateBearerToken(jwtConfig) };
        } else {
            const credentials = getManagementApiCredentials();
            requestParams.auth = { user: credentials.user, password: credentials.password };
        }
    }

    if (options?.body != null) {
        requestParams.body = JSON.stringify(options.body);
    }

    let response: HttpResponse;
    try {
        response = request(requestParams);
    } catch (e) {
        throw new Error(`Management API request failed: ${String(e)}`);
    }

    if (response.status < 200 || response.status >= 300) {
        let message = `Management API error ${response.status}`;
        if (response.body != null) {
            try {
                const errorBody = JSON.parse(response.body) as { message?: string };
                if (errorBody.message != null) {
                    message = `${message}: ${errorBody.message}`;
                }
            } catch (_) {
                // body is not JSON, use status-only message
            }
        }
        throw new Error(message);
    }

    if (response.body == null) {
        throw new Error('Management API returned empty response');
    }

    return JSON.parse(response.body) as T;
}

//
// * Snapshot Operations
//

export function listSnapshots(authHeader?: string): ManagementApiSnapshot[] {
    const result = managementApiRequest<ListSnapshotsResponse>('repo/snapshot/list', { authHeader });
    return result.results;
}

export function createSnapshot(repositoryId: string, authHeader?: string): ManagementApiSnapshot {
    return managementApiRequest<ManagementApiSnapshot>('repo/snapshot', {
        method: 'POST',
        body: { repositoryId },
        authHeader,
    });
}

export function restoreSnapshot(snapshotName: string, repositoryId?: string, authHeader?: string): RestoreSnapshotResponse {
    const body: { snapshotName: string; repositoryId?: string } = { snapshotName };
    if (repositoryId != null) {
        body.repositoryId = repositoryId;
    }
    return managementApiRequest<RestoreSnapshotResponse>('repo/snapshot/restore', {
        method: 'POST',
        body,
        authHeader,
    });
}

export function deleteSnapshot(snapshotName: string, authHeader?: string): DeleteSnapshotsResponse {
    return managementApiRequest<DeleteSnapshotsResponse>('repo/snapshot/delete', {
        method: 'POST',
        body: { snapshotNames: [snapshotName] },
        authHeader,
    });
}
