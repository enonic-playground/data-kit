import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';

//
// * Types
//

export type LogFile = {
  name: string;
  size: number;
  modified: string;
  active: boolean;
};

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
  /** Lines the requested levels admit; absent when no filter is active. */
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

export type LogLocation = {
  position: number;
  visible: boolean;
};

/**
 * How far the whole-file count for one query has got. `levels` is the per-level split of every
 * match found so far, indexed by level code — the caller sums it against its own filter, which
 * is why no level parameter reaches the count.
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

/**
 * How the bean reports a scan that could not deliver. It is transport between the bean and this
 * file only — an `ok` response is unwrapped before it reaches the client, and the other two
 * become a status code.
 */
type BeanStatus = {
  status: 'ok' | 'aborted' | 'stale' | 'busy';
};

//
// * Constants
//

const VALID_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.log$/;
const DEFAULT_COUNT = 200;
const MIN_COUNT = 1;
const MAX_COUNT = 1000;
const MAX_QUERY_LENGTH = 500;
const MAX_LEVELS_LENGTH = 64;

// ! Bit positions must match the level codes in `LogManager.kt`.
const LEVEL_BITS: Record<string, number | undefined> = {
  TRACE: 1 << 1,
  DEBUG: 1 << 2,
  INFO: 1 << 3,
  WARN: 1 << 4,
  ERROR: 1 << 5,
};

const NO_FILTER = 0;
const INVALID_LEVELS = -1;

// ? The bean throws IllegalArgumentException carrying this prefix for a rejected pattern.
const INVALID_REGEX_MARKER = 'Invalid regular expression';

//
// * Bean
//

const logManager = __.newBean<LogManager>('com.enonic.app.datakit.LogManager');

//
// * Helpers
//

function parseNumber(value: string | undefined, fallback: number): number {
  if (value == null || value.length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function notFound(file: string): Response {
  return errorResponse(404, `Log file '${file}' not found`, 'NOT_FOUND');
}

/** Level bitmask for a `levels` parameter, or [INVALID_LEVELS] when it names an unknown level. */
function parseLevels(value: string | undefined): number {
  if (value == null || value.length === 0) return NO_FILTER;
  if (value.length > MAX_LEVELS_LENGTH) return INVALID_LEVELS;

  let mask = NO_FILTER;
  for (const name of value.split(',')) {
    const bit = LEVEL_BITS[name.toUpperCase()];
    if (bit === undefined) return INVALID_LEVELS;
    mask |= bit;
  }
  return mask;
}

//
// * Handlers
//

function listFiles(): Response {
  const files = JSON.parse(logManager.list()) as LogFile[];
  return jsonResponse({ files });
}

function readInfo(file: string, mask: number): Response {
  const json = logManager.info(file, mask);
  if (json == null) return notFound(file);
  return jsonResponse(JSON.parse(json) as LogInfo);
}

function readLines(req: Request, file: string, mask: number): Response {
  const from = Math.max(0, parseNumber(getParam(req, 'from'), 0));
  const count = clamp(parseNumber(getParam(req, 'count'), DEFAULT_COUNT), MIN_COUNT, MAX_COUNT);

  const json = logManager.read(file, from, count, mask);
  if (json == null) return notFound(file);
  return jsonResponse(JSON.parse(json) as LogLines);
}

function locateLine(req: Request, file: string, mask: number): Response {
  const line = getParam(req, 'line');
  if (line == null || line.length === 0) {
    return errorResponse(400, 'line is required', 'VALIDATION_ERROR');
  }

  const json = logManager.locate(file, mask, Math.max(0, parseNumber(line, 0)));
  if (json == null) return notFound(file);
  return jsonResponse(JSON.parse(json) as LogLocation);
}

/** The `query` a scanning action needs, or the response explaining why it has none. */
function requireQuery(req: Request): string | Response {
  const query = getParam(req, 'query');
  if (query == null || query.length === 0) {
    return errorResponse(400, 'query is required', 'VALIDATION_ERROR');
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return errorResponse(
      400,
      `query must be at most ${MAX_QUERY_LENGTH} characters`,
      'VALIDATION_ERROR',
    );
  }
  return query;
}

/** A rejected pattern reaches the API as a thrown message rather than a status. */
function scanFailure(e: unknown): Response {
  const message = String(e);
  const marker = message.indexOf(INVALID_REGEX_MARKER);
  if (marker >= 0) return errorResponse(400, message.slice(marker), 'VALIDATION_ERROR');
  return errorResponse(500, message, 'INTERNAL_ERROR');
}

/** The response for a scan that did not finish, or `null` when it did. */
function scanStatus(status: string): Response | null {
  if (status === 'stale') {
    return errorResponse(
      409,
      'Search stopped: the log file changed while it was being scanned',
      'SEARCH_STALE',
    );
  }
  if (status === 'aborted') {
    return errorResponse(
      400,
      'Search stopped: the pattern took too long to evaluate',
      'SEARCH_TIMEOUT',
    );
  }
  // ? Nothing ran, so nothing is wrong with the request — it is worth sending again.
  if (status === 'busy') {
    return errorResponse(503, 'Too many searches running; try again', 'SEARCH_BUSY');
  }
  return null;
}

function searchLines(req: Request, file: string, mask: number): Response {
  const query = requireQuery(req);
  if (typeof query !== 'string') return query;

  const direction = getParam(req, 'direction') ?? 'forward';
  if (direction !== 'forward' && direction !== 'backward') {
    return errorResponse(400, 'direction must be forward or backward', 'VALIDATION_ERROR');
  }

  const from = Math.max(0, parseNumber(getParam(req, 'from'), 0));
  const regex = getParam(req, 'regex') === 'true';
  const caseSensitive = getParam(req, 'caseSensitive') === 'true';

  let json: string | null;
  try {
    json = logManager.search(
      file,
      query,
      from,
      direction === 'forward',
      regex,
      caseSensitive,
      mask,
    );
  } catch (e) {
    return scanFailure(e);
  }

  if (json == null) return notFound(file);

  const { status, ...result } = JSON.parse(json) as LogSearchResult & BeanStatus;
  return scanStatus(status) ?? jsonResponse<LogSearchResult>(result);
}

function countMatches(req: Request, file: string): Response {
  const query = requireQuery(req);
  if (typeof query !== 'string') return query;

  const regex = getParam(req, 'regex') === 'true';
  const caseSensitive = getParam(req, 'caseSensitive') === 'true';

  let json: string | null;
  try {
    json = logManager.matches(file, query, regex, caseSensitive);
  } catch (e) {
    return scanFailure(e);
  }

  if (json == null) return notFound(file);

  const { status, ...result } = JSON.parse(json) as LogMatchCount & BeanStatus;
  return scanStatus(status) ?? jsonResponse<LogMatchCount>(result);
}

function downloadFile(file: string): Response {
  const stream = logManager.download(file);
  if (stream == null) return notFound(file);

  return {
    status: 200,
    contentType: 'text/plain; charset=utf-8',
    body: stream,
    headers: {
      'Content-Disposition': `attachment; filename="${file}"`,
    },
  };
}

export function get(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const action = getParam(req, 'action');
  const file = getParam(req, 'file');

  if (file == null) {
    if (action != null) {
      return errorResponse(400, 'file is required', 'VALIDATION_ERROR');
    }
    try {
      return listFiles();
    } catch (e) {
      return errorResponse(500, String(e), 'INTERNAL_ERROR');
    }
  }

  if (!VALID_FILE_PATTERN.test(file)) {
    return errorResponse(400, 'file is not a valid log file name', 'VALIDATION_ERROR');
  }

  const mask = parseLevels(getParam(req, 'levels'));
  if (mask === INVALID_LEVELS) {
    return errorResponse(
      400,
      'levels must be a comma-separated list of TRACE, DEBUG, INFO, WARN and ERROR',
      'VALIDATION_ERROR',
    );
  }

  try {
    if (action == null) return readLines(req, file, mask);
    if (action === 'info') return readInfo(file, mask);
    if (action === 'search') return searchLines(req, file, mask);
    if (action === 'matches') return countMatches(req, file);
    if (action === 'locate') return locateLine(req, file, mask);
    if (action === 'download') return downloadFile(file);
    return errorResponse(400, `Unknown action '${action}'`, 'VALIDATION_ERROR');
  } catch (e) {
    return errorResponse(500, String(e), 'INTERNAL_ERROR');
  }
}
