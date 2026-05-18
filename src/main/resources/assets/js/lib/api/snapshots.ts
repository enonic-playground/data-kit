import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { getConfig } from '../config';
import { apiFetch } from './client';

export type Snapshot = {
  name: string;
  reason: string;
  timestamp: string;
  state: string;
  indices: string[];
};

export type RestoreResult = {
  message: string;
  name: string;
  failed: boolean;
  indices: string[];
};

type DeleteResult = {
  deletedSnapshots: string[];
};

export function fetchSnapshots(): Promise<Snapshot[]> {
  const { apiUris } = getConfig();
  return apiFetch<Snapshot[]>(apiUris.snapshots);
}

export function createSnapshot(repositoryId: string): Promise<Snapshot> {
  const { apiUris } = getConfig();
  return apiFetch<Snapshot>(apiUris.snapshots, {
    method: 'POST',
    body: { repositoryId },
  });
}

export function restoreSnapshot(data: {
  snapshotName: string;
  repositoryId?: string;
}): Promise<RestoreResult> {
  const { apiUris } = getConfig();
  return apiFetch<RestoreResult>(apiUris.snapshots, {
    method: 'POST',
    params: { action: 'restore' },
    body: data,
  });
}

export function deleteSnapshot(snapshotName: string): Promise<DeleteResult> {
  const { apiUris } = getConfig();
  return apiFetch<DeleteResult>(apiUris.snapshots, {
    method: 'DELETE',
    params: { snapshotName },
  });
}

export function snapshotsQueryOptions() {
  return queryOptions({
    queryKey: ['snapshots'],
    queryFn: fetchSnapshots,
    retry: false,
  });
}

export function useCreateSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createSnapshot,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] });
    },
  });
}

export function useRestoreSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restoreSnapshot,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] });
    },
  });
}

export function useDeleteSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSnapshot,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snapshots'] });
    },
  });
}
