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

export type LogLocation = {
  position: number;
  visible: boolean;
};

/** Where a time window begins. `time` is `null` when nothing was cut. */
export type LogWindow = {
  line: number;
  time: string | null;
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

// ! Must stay in step with `MAX_WINDOW_MINUTES` in `LogManager.kt`, which clamps to it anyway;
// ! rejecting here is what turns a nonsense window into a message rather than a silent clamp.
const MAX_WINDOW_MINUTES = 7 * 24 * 60;

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

function resolveWindow(req: Request, file: string): Response {
  const minutes = parseNumber(getParam(req, 'minutes'), 0);
  if (minutes < 1 || minutes > MAX_WINDOW_MINUTES) {
    return errorResponse(
      400,
      `minutes must be between 1 and ${MAX_WINDOW_MINUTES}`,
      'VALIDATION_ERROR',
    );
  }

  const json = logManager.window(file, minutes);
  if (json == null) return notFound(file);
  return jsonResponse(JSON.parse(json) as LogWindow);
}

function readInfo(file: string, mask: number, start: number): Response {
  const json = logManager.info(file, mask, start);
  if (json == null) return notFound(file);
  return jsonResponse(JSON.parse(json) as LogInfo);
}

function readLines(req: Request, file: string, mask: number, start: number): Response {
  const from = Math.max(0, parseNumber(getParam(req, 'from'), 0));
  const count = clamp(parseNumber(getParam(req, 'count'), DEFAULT_COUNT), MIN_COUNT, MAX_COUNT);

  const json = logManager.read(file, from, count, mask, start);
  if (json == null) return notFound(file);
  return jsonResponse(JSON.parse(json) as LogLines);
}

function locateLine(req: Request, file: string, mask: number, start: number): Response {
  const line = getParam(req, 'line');
  if (line == null || line.length === 0) {
    return errorResponse(400, 'line is required', 'VALIDATION_ERROR');
  }

  const json = logManager.locate(file, mask, Math.max(0, parseNumber(line, 0)), start);
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

function searchLines(req: Request, file: string, mask: number, start: number): Response {
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
      start,
    );
  } catch (e) {
    return scanFailure(e);
  }

  if (json == null) return notFound(file);

  const { status, ...result } = JSON.parse(json) as LogSearchResult & BeanStatus;
  return scanStatus(status) ?? jsonResponse<LogSearchResult>(result);
}

function countMatches(req: Request, file: string, start: number): Response {
  const query = requireQuery(req);
  if (typeof query !== 'string') return query;

  const regex = getParam(req, 'regex') === 'true';
  const caseSensitive = getParam(req, 'caseSensitive') === 'true';

  let json: string | null;
  try {
    json = logManager.matches(file, query, regex, caseSensitive, start);
  } catch (e) {
    return scanFailure(e);
  }

  if (json == null) return notFound(file);

  const { status, ...result } = JSON.parse(json) as LogMatchCount & BeanStatus;
  return scanStatus(status) ?? jsonResponse<LogMatchCount>(result);
}

/**
 * A windowed download is a different file from the one it was cut out of, so it is named for the
 * line it starts on — in the 1-based numbering the viewer's gutter shows. Derived from the parsed
 * number rather than from any parameter text, which is what keeps the header uninjectable.
 */
function downloadName(file: string, start: number): string {
  if (start <= 0) return file;
  return `${file.slice(0, -'.log'.length)}.from-${start + 1}.log`;
}

function downloadFile(file: string, start: number): Response {
  const stream = logManager.download(file, start);
  if (stream == null) return notFound(file);

  return {
    status: 200,
    contentType: 'text/plain; charset=utf-8',
    body: stream,
    headers: {
      'Content-Disposition': `attachment; filename="${downloadName(file, start)}"`,
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

  const start = Math.max(0, parseNumber(getParam(req, 'start'), 0));

  try {
    if (action == null) return readLines(req, file, mask, start);
    if (action === 'window') return resolveWindow(req, file);
    if (action === 'info') return readInfo(file, mask, start);
    if (action === 'search') return searchLines(req, file, mask, start);
    if (action === 'matches') return countMatches(req, file, start);
    if (action === 'locate') return locateLine(req, file, mask, start);
    if (action === 'download') return downloadFile(file, start);
    return errorResponse(400, `Unknown action '${action}'`, 'VALIDATION_ERROR');
  } catch (e) {
    return errorResponse(500, String(e), 'INTERNAL_ERROR');
  }
}
