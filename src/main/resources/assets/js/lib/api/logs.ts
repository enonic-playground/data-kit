import { queryOptions } from '@tanstack/react-query';

import { getConfig } from '../config';
import { apiFetch, buildUrl } from './client';

export type LogFile = {
  name: string;
  size: number;
  modified: string;
  active: boolean;
};

export type LogFilesResult = {
  files: LogFile[];
};

export type LogInfo = {
  name: string;
  size: number;
  modified: string;
  lines: number;
};

export type LogLines = {
  from: number;
  lines: string[];
  total: number;
  size: number;
};

export type LogSearchDirection = 'forward' | 'backward';

export type LogSearchResult = {
  line: number | null;
};

export type LogSearchParams = {
  file: string;
  query: string;
  from: number;
  direction: LogSearchDirection;
  regex?: boolean;
  caseSensitive?: boolean;
  signal?: AbortSignal;
};

export function fetchLogFiles(signal?: AbortSignal): Promise<LogFile[]> {
  const { apiUris } = getConfig();
  return apiFetch<LogFilesResult>(apiUris.logs, { signal }).then((result) => result.files);
}

export function fetchLogInfo(file: string, signal?: AbortSignal): Promise<LogInfo> {
  const { apiUris } = getConfig();
  return apiFetch<LogInfo>(apiUris.logs, {
    params: { file, action: 'info' },
    signal,
  });
}

export function fetchLogLines(
  file: string,
  from: number,
  count: number,
  signal?: AbortSignal,
): Promise<LogLines> {
  const { apiUris } = getConfig();
  return apiFetch<LogLines>(apiUris.logs, {
    params: { file, from: String(from), count: String(count) },
    signal,
  });
}

export function searchLog({
  file,
  query,
  from,
  direction,
  regex = false,
  caseSensitive = false,
  signal,
}: LogSearchParams): Promise<LogSearchResult> {
  const { apiUris } = getConfig();
  return apiFetch<LogSearchResult>(apiUris.logs, {
    params: {
      file,
      action: 'search',
      query,
      from: String(from),
      direction,
      regex: String(regex),
      caseSensitive: String(caseSensitive),
    },
    signal,
  });
}

export function logDownloadUrl(file: string): string {
  const { apiUris } = getConfig();
  return buildUrl(apiUris.logs, { file, action: 'download' });
}

export function logFilesQueryOptions() {
  return queryOptions({
    queryKey: ['logs', 'files'],
    queryFn: ({ signal }) => fetchLogFiles(signal),
  });
}

export function logInfoQueryOptions(file: string | undefined, refetchInterval?: number) {
  const name = file ?? '';
  return queryOptions({
    queryKey: ['logs', 'info', name],
    queryFn: ({ signal }) => fetchLogInfo(name, signal),
    enabled: name !== '',
    refetchInterval,
    retry: false,
  });
}
