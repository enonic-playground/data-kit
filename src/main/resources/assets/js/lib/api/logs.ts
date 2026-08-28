import { queryOptions } from '@tanstack/react-query';

import { getConfig } from '../config';
import { apiFetch, buildUrl } from './client';

// ! Order and spelling are the wire contract for the `levels` parameter, and the counts below
// ! are keyed by the lowercase form of the same names.
export const LOG_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFile = {
  name: string;
  size: number;
  modified: string;
  /** The file the tool opens by default. Exactly one entry carries it. */
  active: boolean;
  /** Nothing can be appended to this file again, so there is nothing to follow or re-poll. */
  rotated: boolean;
};

export type LogFilesResult = {
  files: LogFile[];
};

/** Lines per level, `unknown` being a continuation with no entry above it to inherit from. */
export type LogLevelCounts = {
  unknown: number;
  trace: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
};

export type LogInfo = {
  name: string;
  size: number;
  modified: string;
  lines: number;
  levels: LogLevelCounts;
  /** Lines the active filter admits; absent when no filter is active. */
  filtered?: number;
};

export type LogLines = {
  from: number;
  lines: string[];
  /** Physical line number of each entry in `lines`; absent when no filter is active. */
  numbers?: number[];
  total: number;
  size: number;
};

/** Where a physical line sits in the filtered view, or the nearest visible line to it. */
export type LogLocation = {
  position: number;
  visible: boolean;
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
  /** Scopes the search: a match is only ever a line these levels admit. */
  levels: readonly LogLevel[];
  regex?: boolean;
  caseSensitive?: boolean;
  signal?: AbortSignal;
};

/**
 * Canonical `levels` query value, or `undefined` when the selection is not a filter. Selecting
 * none is the same view as selecting all, so both mean "no filter" rather than "show nothing".
 */
export function levelsParam(levels: readonly LogLevel[]): string | undefined {
  const selected = LOG_LEVELS.filter((level) => levels.includes(level));
  if (selected.length === 0 || selected.length === LOG_LEVELS.length) return undefined;
  return selected.join(',');
}

function withLevels(
  params: Record<string, string>,
  levels: readonly LogLevel[],
): Record<string, string> {
  const value = levelsParam(levels);
  if (value != null) params.levels = value;
  return params;
}

export function fetchLogFiles(signal?: AbortSignal): Promise<LogFile[]> {
  const { apiUris } = getConfig();
  return apiFetch<LogFilesResult>(apiUris.logs, { signal }).then((result) => result.files);
}

export function fetchLogInfo(
  file: string,
  levels: readonly LogLevel[],
  signal?: AbortSignal,
): Promise<LogInfo> {
  const { apiUris } = getConfig();
  return apiFetch<LogInfo>(apiUris.logs, {
    params: withLevels({ file, action: 'info' }, levels),
    signal,
  });
}

export function fetchLogLines(
  file: string,
  from: number,
  count: number,
  levels: readonly LogLevel[],
  signal?: AbortSignal,
): Promise<LogLines> {
  const { apiUris } = getConfig();
  return apiFetch<LogLines>(apiUris.logs, {
    params: withLevels({ file, from: String(from), count: String(count) }, levels),
    signal,
  });
}

export function locateLogLine(
  file: string,
  line: number,
  levels: readonly LogLevel[],
  signal?: AbortSignal,
): Promise<LogLocation> {
  const { apiUris } = getConfig();
  return apiFetch<LogLocation>(apiUris.logs, {
    params: withLevels({ file, action: 'locate', line: String(line) }, levels),
    signal,
  });
}

export function searchLog({
  file,
  query,
  from,
  direction,
  levels,
  regex = false,
  caseSensitive = false,
  signal,
}: LogSearchParams): Promise<LogSearchResult> {
  const { apiUris } = getConfig();
  return apiFetch<LogSearchResult>(apiUris.logs, {
    params: withLevels(
      {
        file,
        action: 'search',
        query,
        from: String(from),
        direction,
        regex: String(regex),
        caseSensitive: String(caseSensitive),
      },
      levels,
    ),
    signal,
  });
}

export function logDownloadUrl(file: string): string {
  const { apiUris } = getConfig();
  return buildUrl(apiUris.logs, { file, action: 'download' });
}

export function logFilesQueryOptions(refetchInterval?: number) {
  return queryOptions({
    queryKey: ['logs', 'files'],
    queryFn: ({ signal }) => fetchLogFiles(signal),
    refetchInterval,
  });
}

export function logInfoQueryOptions(
  file: string | undefined,
  levels: readonly LogLevel[],
  // ? `false` for a rotated file: its size, counts and timestamps are frozen, so there is
  // ? nothing for a poll to discover. Refresh and refetch-on-focus still re-read it.
  refetchInterval?: number | false,
) {
  const name = file ?? '';
  return queryOptions({
    // ? Keyed by the canonical parameter, not the array: two selections that filter the same
    // ? way must not hold two cache entries.
    queryKey: ['logs', 'info', name, levelsParam(levels) ?? ''],
    queryFn: ({ signal }) => fetchLogInfo(name, levels, signal),
    enabled: name !== '',
    refetchInterval,
    retry: false,
  });
}
