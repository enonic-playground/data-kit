import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { getConfig } from '../config';
import { apiFetch, apiUpload, buildUrl } from './client';

export type Dump = {
  name: string;
  timestamp: string;
  type: 'versioned' | 'archived' | 'export';
  xpVersion: string;
  modelVersion: string;
  size: number;
};

export type CreateDumpOptions = {
  name: string;
  includeVersions?: boolean;
  maxAge?: number;
  maxVersions?: number;
};

export type LoadDumpOptions = {
  name: string;
  upgrade?: boolean;
  archive?: boolean;
};

type TaskIdResult = {
  taskId: string;
};

export function fetchDumps(): Promise<Dump[]> {
  const { apiUris } = getConfig();
  return apiFetch<Dump[]>(apiUris.dumps);
}

export function createDump(options: CreateDumpOptions): Promise<TaskIdResult> {
  const { apiUris } = getConfig();
  return apiFetch<TaskIdResult>(apiUris.dumps, {
    method: 'POST',
    body: options,
  });
}

export function loadDump(options: LoadDumpOptions): Promise<TaskIdResult> {
  const { apiUris } = getConfig();
  return apiFetch<TaskIdResult>(apiUris.dumps, {
    method: 'POST',
    params: { action: 'load' },
    body: options,
  });
}

export function deleteDump(name: string): Promise<{ success: boolean }> {
  const { apiUris } = getConfig();
  return apiFetch<{ success: boolean }>(apiUris.dumps, {
    method: 'DELETE',
    params: { name },
  });
}

export function upgradeDump(name: string): Promise<TaskIdResult> {
  const { apiUris } = getConfig();
  return apiFetch<TaskIdResult>(apiUris.dumps, {
    method: 'POST',
    params: { action: 'upgrade' },
    body: { name },
  });
}

export function getDumpDownloadUrl(name: string): string {
  const { apiUris } = getConfig();
  return buildUrl(apiUris.dumps, { action: 'download', name });
}

export function uploadDump(file: File, onProgress?: (percent: number) => void): Promise<void> {
  const { apiUris } = getConfig();
  return apiUpload(apiUris.dumps, { file, params: { action: 'upload' }, onProgress });
}

export function dumpsQueryOptions() {
  return queryOptions({
    queryKey: ['dumps'],
    queryFn: fetchDumps,
  });
}

export function useCreateDump() {
  return useMutation({
    mutationFn: createDump,
  });
}

export function useLoadDump() {
  return useMutation({
    mutationFn: loadDump,
  });
}

export function useDeleteDump() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteDump,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dumps'] });
    },
  });
}

export function useUpgradeDump() {
  return useMutation({
    mutationFn: upgradeDump,
  });
}

type UploadDumpParams = {
  file: File;
  onProgress?: (percent: number) => void;
};

export function useUploadDump() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, onProgress }: UploadDumpParams) => uploadDump(file, onProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dumps'] });
    },
  });
}
