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
  /** Lines the view holds under the level filter and the window; absent when neither narrows it. */
  filtered?: number;
};

export type LogLines = {
  from: number;
  lines: string[];
  /** Physical line number of each entry in `lines`; absent when the view is the whole file. */
  numbers?: number[];
  total: number;
  size: number;
};

/** Where a physical line sits in the narrowed view, or the nearest visible line to it. */
export type LogLocation = {
  position: number;
  visible: boolean;
};

/**
 * Where a time window begins, resolved once against the file's last entry. `time` is the
 * `HH:mm:ss.SSS` of `line`, and both are absent of any cut when the whole file is inside the
 * window — `line` is then `0` and `time` is `null`.
 */
export type LogWindow = {
  line: number;
  time: string | null;
};

/**
 * Minutes each preset cuts back from the file's last entry. The cut is resolved once and then
 * held as a line number, so the view grows at its end as the file does rather than sliding.
 */
export const LOG_WINDOWS = [15, 30, 60, 360] as const;

export type LogWindowMinutes = (typeof LOG_WINDOWS)[number];

export type LogSearchDirection = 'forward' | 'backward';

/**
 * How far the whole-file count for one query has got. `levels` is every match found so far split
 * by level code, so the visible and hidden halves of a filtered view are a sum over it rather
 * than a second request — which is why the count itself takes no levels.
 */
export type LogMatchCount = {
  total: number;
  levels: number[];
  scanned: number;
  lines: number;
  complete: boolean;
};

export type LogSearchResult = LogMatchCount & {
  line: number | null;
  /** Zero-based position of `line` among the matches the active filter admits. */
  ordinal: number | null;
};

/** Matches the active filter shows, and matches it hides. */
export type MatchSplit = {
  visible: number;
  hidden: number;
};

export type LogSearchParams = {
  file: string;
  query: string;
  from: number;
  direction: LogSearchDirection;
  /** Scopes the search: a match is only ever a line these levels admit. */
  levels: readonly LogLevel[];
  /** Scopes it further: no match is ever above the window's first physical line. */
  start: number;
  regex?: boolean;
  caseSensitive?: boolean;
  signal?: AbortSignal;
};

/** What a reader committed to when they ran a search, as opposed to what they are still typing. */
export type SearchCriteria = {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
};

const EMPTY_CRITERIA: SearchCriteria = { query: '', regex: false, caseSensitive: false };

export type LogMatchParams = {
  file: string;
  query: string;
  start: number;
  regex?: boolean;
  caseSensitive?: boolean;
  signal?: AbortSignal;
};

// ! Index into `LogMatchCount.levels` is the level code in `LogManager.kt`, which sits one past
// ! the position in `LOG_LEVELS` — code 0 is `unknown`, a continuation with no level of its own.
const LEVEL_CODE_OFFSET = 1;

// ? Long enough not to hammer the API between slices, short enough that a count of a large file
// ? still reads as one continuous operation rather than a series of steps.
const MATCH_SLICE_GAP_MS = 100;

/**
 * Canonical `levels` query value, or `undefined` when the selection is not a filter. Selecting
 * none is the same view as selecting all, so both mean "no filter" rather than "show nothing".
 */
export function levelsParam(levels: readonly LogLevel[]): string | undefined {
  const selected = LOG_LEVELS.filter((level) => levels.includes(level));
  if (selected.length === 0 || selected.length === LOG_LEVELS.length) return undefined;
  return selected.join(',');
}

/** Splits `counts` into the matches `levels` admits and the matches it hides. */
export function matchSplit(counts: number[], levels: readonly LogLevel[]): MatchSplit {
  const total = counts.reduce((sum, count) => sum + count, 0);

  // ? An unfiltered view shows every match, including the `unknown` continuations that no level
  // ? names — so it cannot be reached by summing the levels that are selected.
  if (levelsParam(levels) == null) return { visible: total, hidden: 0 };

  let visible = 0;
  LOG_LEVELS.forEach((level, index) => {
    if (levels.includes(level)) visible += counts[index + LEVEL_CODE_OFFSET] ?? 0;
  });

  return { visible, hidden: total - visible };
}

/** The two parameters that narrow a view, added only when they narrow one. */
function withView(
  params: Record<string, string>,
  levels: readonly LogLevel[],
  start: number,
): Record<string, string> {
  const value = levelsParam(levels);
  if (value != null) params.levels = value;
  if (start > 0) params.start = String(start);
  return params;
}

export function fetchLogFiles(signal?: AbortSignal): Promise<LogFile[]> {
  const { apiUris } = getConfig();
  return apiFetch<LogFilesResult>(apiUris.logs, { signal }).then((result) => result.files);
}

export function fetchLogInfo(
  file: string,
  levels: readonly LogLevel[],
  start: number,
  signal?: AbortSignal,
): Promise<LogInfo> {
  const { apiUris } = getConfig();
  return apiFetch<LogInfo>(apiUris.logs, {
    params: withView({ file, action: 'info' }, levels, start),
    signal,
  });
}

export function fetchLogLines(
  file: string,
  from: number,
  count: number,
  levels: readonly LogLevel[],
  start: number,
  signal?: AbortSignal,
): Promise<LogLines> {
  const { apiUris } = getConfig();
  return apiFetch<LogLines>(apiUris.logs, {
    params: withView({ file, from: String(from), count: String(count) }, levels, start),
    signal,
  });
}

export function locateLogLine(
  file: string,
  line: number,
  levels: readonly LogLevel[],
  start: number,
  signal?: AbortSignal,
): Promise<LogLocation> {
  const { apiUris } = getConfig();
  return apiFetch<LogLocation>(apiUris.logs, {
    params: withView({ file, action: 'locate', line: String(line) }, levels, start),
    signal,
  });
}

/** Resolves a preset against the file's last entry. The line it returns is held, not re-asked. */
export function fetchLogWindow(
  file: string,
  minutes: number,
  signal?: AbortSignal,
): Promise<LogWindow> {
  const { apiUris } = getConfig();
  return apiFetch<LogWindow>(apiUris.logs, {
    params: { file, action: 'window', minutes: String(minutes) },
    signal,
  });
}

export function searchLog({
  file,
  query,
  from,
  direction,
  levels,
  start,
  regex = false,
  caseSensitive = false,
  signal,
}: LogSearchParams): Promise<LogSearchResult> {
  const { apiUris } = getConfig();
  return apiFetch<LogSearchResult>(apiUris.logs, {
    params: withView(
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
      start,
    ),
    signal,
  });
}

export function fetchLogMatches({
  file,
  query,
  start,
  regex = false,
  caseSensitive = false,
  signal,
}: LogMatchParams): Promise<LogMatchCount> {
  const { apiUris } = getConfig();
  const params: Record<string, string> = {
    file,
    action: 'matches',
    query,
    regex: String(regex),
    caseSensitive: String(caseSensitive),
  };
  if (start > 0) params.start = String(start);

  return apiFetch<LogMatchCount>(apiUris.logs, { params, signal });
}

export function logDownloadUrl(file: string, start: number): string {
  const { apiUris } = getConfig();
  const params: Record<string, string> = { file, action: 'download' };
  if (start > 0) params.start = String(start);
  return buildUrl(apiUris.logs, params);
}

export function logFilesQueryOptions(refetchInterval?: number) {
  return queryOptions({
    queryKey: ['logs', 'files'],
    queryFn: ({ signal }) => fetchLogFiles(signal),
    refetchInterval,
  });
}

/**
 * The whole-file match count for the criteria a reader has committed to — `null` until they run a
 * search, because a count is a scan of the entire file and the query being typed is not one they
 * have asked for yet.
 *
 * The key holds no levels, mirroring the server: a filter is applied to the finished counts, so
 * toggling one must not discard a scan in progress.
 */
export function logMatchesQueryOptions(
  file: string | undefined,
  criteria: SearchCriteria | null,
  start: number,
) {
  const name = file ?? '';
  const { query, regex, caseSensitive } = criteria ?? EMPTY_CRITERIA;

  return queryOptions({
    // ? The window is in the key where the levels are not: it narrows the counts that come back,
    // ? so two windows are two answers. The scan behind them is shared and survives either way.
    queryKey: ['logs', 'matches', name, query, regex, caseSensitive, start],
    queryFn: ({ signal }) =>
      fetchLogMatches({ file: name, query, start, regex, caseSensitive, signal }),
    enabled: name !== '' && query !== '',
    // ? The request loop is the scheduler: each call extends the scan by one slice, and a
    // ? slice is bounded server side, so this is never an unbounded hold on the file.
    // ! A slice that scanned nothing means the scan was evicted rather than advanced, and
    // ! polling through that never converges — stop with a partial count instead.
    refetchInterval: (cached) => {
      const data = cached.state.data;
      if (data == null || data.complete || data.scanned === 0) return false;
      return MATCH_SLICE_GAP_MS;
    },
    retry: false,
  });
}

export function logInfoQueryOptions(
  file: string | undefined,
  levels: readonly LogLevel[],
  start: number,
  // ? `false` for a rotated file: its size, counts and timestamps are frozen, so there is
  // ? nothing for a poll to discover. Refresh and refetch-on-focus still re-read it.
  refetchInterval?: number | false,
) {
  const name = file ?? '';
  return queryOptions({
    // ? Keyed by the canonical parameter, not the array: two selections that filter the same
    // ? way must not hold two cache entries.
    queryKey: ['logs', 'info', name, levelsParam(levels) ?? '', start],
    queryFn: ({ signal }) => fetchLogInfo(name, levels, start, signal),
    enabled: name !== '',
    refetchInterval,
    retry: false,
  });
}
