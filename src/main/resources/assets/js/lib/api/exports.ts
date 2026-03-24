import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { getConfig } from '../config';
import { apiFetch, apiUpload, buildUrl } from './client';

export type ExportEntry = {
    name: string;
    timestamp: string;
    format: 'directory' | 'zip';
    nodeCount: number;
    size: number;
};

export type CreateExportOptions = {
    repositoryId: string;
    branch: string;
    nodePath: string;
    exportName: string;
};

export type ImportExportOptions = {
    exportName: string;
    repositoryId: string;
    branch: string;
    targetNodePath: string;
    includeNodeIds?: boolean;
    includePermissions?: boolean;
};

type TaskIdResult = {
    taskId: string;
};

export function fetchExports(): Promise<ExportEntry[]> {
    const { apiUris } = getConfig();
    return apiFetch<ExportEntry[]>(apiUris.exports);
}

export function createExport(options: CreateExportOptions): Promise<TaskIdResult> {
    const { apiUris } = getConfig();
    return apiFetch<TaskIdResult>(apiUris.exports, {
        method: 'POST',
        body: options,
    });
}

export function importExport(options: ImportExportOptions): Promise<TaskIdResult> {
    const { apiUris } = getConfig();
    return apiFetch<TaskIdResult>(apiUris.exports, {
        method: 'POST',
        params: { action: 'import' },
        body: options,
    });
}

export function deleteExport(name: string): Promise<{ success: boolean }> {
    const { apiUris } = getConfig();
    return apiFetch<{ success: boolean }>(apiUris.exports, {
        method: 'DELETE',
        params: { name },
    });
}

export function getExportDownloadUrl(name: string): string {
    const { apiUris } = getConfig();
    return buildUrl(apiUris.exports, { action: 'download', name });
}

export function uploadExport(file: File, onProgress?: (percent: number) => void): Promise<void> {
    const { apiUris } = getConfig();
    return apiUpload(apiUris.exports, { file, params: { action: 'upload' }, onProgress });
}

export function exportsQueryOptions() {
    return queryOptions({
        queryKey: ['exports'],
        queryFn: fetchExports,
    });
}

export function useCreateExport() {
    return useMutation({
        mutationFn: createExport,
    });
}

export function useImportExport() {
    return useMutation({
        mutationFn: importExport,
    });
}

export function useDeleteExport() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: deleteExport,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['exports'] });
        },
    });
}

type UploadExportParams = {
    file: File;
    onProgress?: (percent: number) => void;
};

export function useUploadExport() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ file, onProgress }: UploadExportParams) => uploadExport(file, onProgress),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['exports'] });
        },
    });
}
