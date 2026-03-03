import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
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

//
// * Node Mutations
//

export type CreateNodeParams = {
    repoId: string;
    branch: string;
    parentPath: string;
    name: string;
    nodeType?: string;
};

export type RenameNodeParams = {
    repoId: string;
    branch: string;
    key: string;
    newName: string;
};

export type MoveNodeParams = {
    repoId: string;
    branch: string;
    key: string;
    targetPath: string;
};

export type DeleteNodeParams = {
    repoId: string;
    branch: string;
    key: string;
    allBranches?: boolean;
};

export type PushNodeParams = {
    repoId: string;
    branch: string;
    key: string;
    target: string;
    includeChildren?: boolean;
    resolve?: boolean;
};

export type PushNodeResult = {
    success: string[];
    failed: { id: string; reason: string }[];
    deleted: string[];
};

export type DuplicateNodeParams = {
    repoId: string;
    branch: string;
    nodeId: string;
    name?: string;
    includeChildren?: boolean;
};

export function createNode(params: CreateNodeParams): Promise<NodeDetail> {
    const { apiUris } = getConfig();
    return apiFetch<NodeDetail>(apiUris.nodes, {
        method: 'POST',
        body: params,
    });
}

export function renameNode(params: RenameNodeParams): Promise<{ success: boolean }> {
    const { apiUris } = getConfig();
    return apiFetch<{ success: boolean }>(apiUris.nodes, {
        method: 'PUT',
        params: { action: 'rename' },
        body: params,
    });
}

export function moveNode(params: MoveNodeParams): Promise<{ success: boolean }> {
    const { apiUris } = getConfig();
    return apiFetch<{ success: boolean }>(apiUris.nodes, {
        method: 'PUT',
        params: { action: 'move' },
        body: params,
    });
}

export type DeleteNodeResult = {
    key: string;
    deleted: boolean;
    branches?: { deleted: string[]; failed: string[] };
};

export function deleteNode(params: DeleteNodeParams): Promise<DeleteNodeResult> {
    const { apiUris } = getConfig();
    const queryParams: Record<string, string> = {
        repoId: params.repoId,
        branch: params.branch,
        key: params.key,
    };
    if (params.allBranches) {
        queryParams.allBranches = 'true';
    }
    return apiFetch<DeleteNodeResult>(apiUris.nodes, {
        method: 'DELETE',
        params: queryParams,
    });
}

export function pushNode(params: PushNodeParams): Promise<PushNodeResult> {
    const { apiUris } = getConfig();
    return apiFetch<PushNodeResult>(apiUris.nodes, {
        method: 'POST',
        params: { action: 'push' },
        body: params,
    });
}

export function duplicateNode(params: DuplicateNodeParams): Promise<NodeDetail> {
    const { apiUris } = getConfig();
    return apiFetch<NodeDetail>(apiUris.nodes, {
        method: 'POST',
        params: { action: 'duplicate' },
        body: params,
    });
}

export function useCreateNode() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: createNode,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['nodes'] });
        },
    });
}

export function useRenameNode() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: renameNode,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['nodes'] });
            queryClient.invalidateQueries({ queryKey: ['node-detail'] });
        },
    });
}

export function useMoveNode() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: moveNode,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['nodes'] });
            queryClient.invalidateQueries({ queryKey: ['node-detail'] });
        },
    });
}

export function useDeleteNode() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: deleteNode,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['nodes'] });
        },
    });
}

export function usePushNode() {
    return useMutation({
        mutationFn: pushNode,
    });
}

export function useDuplicateNode() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: duplicateNode,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['nodes'] });
        },
    });
}
