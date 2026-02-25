import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { getConfig } from '../config';
import { apiFetch } from './client';

export type Branch = {
    id: string;
};

export function fetchBranches(repoId: string): Promise<Branch[]> {
    const { apiUris } = getConfig();
    return apiFetch<Branch[]>(apiUris.branches, {
        params: { repoId },
    });
}

export function createBranch(repoId: string, branchId: string): Promise<Branch> {
    const { apiUris } = getConfig();
    return apiFetch<Branch>(apiUris.branches, {
        method: 'POST',
        body: { repoId, branchId },
    });
}

export function deleteBranch(repoId: string, branchId: string): Promise<{ id: string; deleted: boolean }> {
    const { apiUris } = getConfig();
    return apiFetch<{ id: string; deleted: boolean }>(apiUris.branches, {
        method: 'DELETE',
        params: { repoId, branchId },
    });
}

export function branchesQueryOptions(repoId: string) {
    return queryOptions({
        queryKey: ['branches', repoId],
        queryFn: () => fetchBranches(repoId),
    });
}

export function useCreateBranch() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ repoId, branchId }: { repoId: string; branchId: string }) =>
            createBranch(repoId, branchId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['branches'] });
        },
    });
}

export function useDeleteBranch() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ repoId, branchId }: { repoId: string; branchId: string }) =>
            deleteBranch(repoId, branchId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['branches'] });
        },
    });
}
