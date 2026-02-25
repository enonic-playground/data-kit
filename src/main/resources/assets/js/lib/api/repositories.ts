import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export type Repository = {
    id: string;
    branches: string[];
};

export function fetchRepositories(): Promise<Repository[]> {
    return apiFetch<Repository[]>('/repositories');
}

export function createRepository(id: string): Promise<Repository> {
    return apiFetch<Repository>('/repositories', {
        method: 'POST',
        body: { id },
    });
}

export function deleteRepository(id: string): Promise<{ id: string; deleted: boolean }> {
    return apiFetch<{ id: string; deleted: boolean }>('/repositories', {
        method: 'DELETE',
        params: { id },
    });
}

export function repositoriesQueryOptions() {
    return queryOptions({
        queryKey: ['repositories'],
        queryFn: fetchRepositories,
    });
}

export function useCreateRepository() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: createRepository,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['repositories'] });
        },
    });
}

export function useDeleteRepository() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: deleteRepository,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['repositories'] });
        },
    });
}
