import { infiniteQueryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { getConfig } from '../config';
import { apiFetch } from './client';

//
// * Types
//

export type NodeCommitEntry = {
  id: string;
  message: string;
  committer: string;
  timestamp: string;
};

export type NodeVersionEntry = {
  versionId: string;
  nodeId: string;
  nodePath: string;
  timestamp: string;
  commitId?: string;
  commit?: NodeCommitEntry | null;
};

export type VersionsResponse = {
  total: number;
  count: number;
  cursor: string | null;
  activeVersionId: string | null;
  hits: NodeVersionEntry[];
};

export type VersionsParams = {
  repoId: string;
  branch: string;
  key: string;
  count?: number;
};

export type SetActiveVersionParams = {
  repoId: string;
  branch: string;
  key: string;
  versionId: string;
};

export type SetActiveVersionResult = {
  key: string;
  versionId: string;
  active: boolean;
};

//
// * Fetch
//

export function fetchVersions(
  params: VersionsParams & { cursor?: string | null },
): Promise<VersionsResponse> {
  const { apiUris } = getConfig();
  const queryParams: Record<string, string> = {
    repoId: params.repoId,
    branch: params.branch,
    key: params.key,
  };
  if (params.cursor != null) queryParams.cursor = params.cursor;
  if (params.count != null) queryParams.count = String(params.count);

  return apiFetch<VersionsResponse>(apiUris.versions, { params: queryParams });
}

export function versionsInfiniteQueryOptions(params: VersionsParams) {
  return infiniteQueryOptions({
    queryKey: ['versions', params.repoId, params.branch, params.key, params.count ?? 25],
    queryFn: ({ pageParam }) => fetchVersions({ ...params, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.cursor != null && last.hits.length > 0 ? last.cursor : undefined,
    retry: false,
  });
}

//
// * Mutations
//

export function setActiveVersion(params: SetActiveVersionParams): Promise<SetActiveVersionResult> {
  const { apiUris } = getConfig();
  return apiFetch<SetActiveVersionResult>(apiUris.versions, {
    method: 'PUT',
    body: params,
  });
}

export function useSetActiveVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setActiveVersion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['versions'] });
      queryClient.invalidateQueries({ queryKey: ['node-detail'] });
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
    },
  });
}
