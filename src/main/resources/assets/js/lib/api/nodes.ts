import { queryOptions } from '@tanstack/react-query';
import { getConfig } from '../config';
import { apiFetch } from './client';

export type NodeEntry = {
    _id: string;
    _name: string;
    _path: string;
    hasChildren: boolean;
    _nodeType: string;
    _ts: string;
};

export type NodesResponse = {
    nodes: NodeEntry[];
    total: number;
};

export type NodesParams = {
    repoId: string;
    branch: string;
    parentPath?: string;
    start?: number;
    count?: number;
};

export function fetchNodes(params: NodesParams): Promise<NodesResponse> {
    const { apiUris } = getConfig();
    const queryParams: Record<string, string> = {
        repoId: params.repoId,
        branch: params.branch,
    };

    if (params.parentPath != null) {
        queryParams.parentPath = params.parentPath;
    }
    if (params.start != null) {
        queryParams.start = String(params.start);
    }
    if (params.count != null) {
        queryParams.count = String(params.count);
    }

    return apiFetch<NodesResponse>(apiUris.nodes, {
        params: queryParams,
    });
}

export function nodesQueryOptions(params: NodesParams) {
    return queryOptions({
        queryKey: [
            'nodes',
            params.repoId,
            params.branch,
            params.parentPath ?? '/',
            params.start ?? 0,
            params.count ?? 25,
        ],
        queryFn: () => fetchNodes(params),
    });
}

//
// * Node Detail
//

export type AccessControlEntry = {
    principal: string;
    allow: string[];
    deny: string[];
};

export type NodeDetail = Record<string, unknown> & {
    _id: string;
    _name: string;
    _path: string;
    _nodeType: string;
    _childOrder: string;
    _ts: string;
    _state: string;
    _versionKey: string;
    _permissions: AccessControlEntry[];
};

export type NodeDetailParams = {
    repoId: string;
    branch: string;
    key: string;
};

export function fetchNodeDetail(params: NodeDetailParams): Promise<NodeDetail> {
    const { apiUris } = getConfig();
    return apiFetch<NodeDetail>(apiUris.nodes, {
        params: {
            repoId: params.repoId,
            branch: params.branch,
            key: params.key,
        },
    });
}

export function nodeDetailQueryOptions(params: NodeDetailParams) {
    return queryOptions({
        queryKey: ['node-detail', params.repoId, params.branch, params.key],
        queryFn: () => fetchNodeDetail(params),
    });
}
