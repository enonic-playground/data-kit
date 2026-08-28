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

export type LogSearchResult = {
  line: number | null;
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

const NOT_FOUND = -2;
const NO_MATCH = -1;
const SEARCH_ABORTED = -3;
const SEARCH_STALE = -4;

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

function searchLines(req: Request, file: string, mask: number): Response {
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

  const direction = getParam(req, 'direction') ?? 'forward';
  if (direction !== 'forward' && direction !== 'backward') {
    return errorResponse(400, 'direction must be forward or backward', 'VALIDATION_ERROR');
  }

  const from = Math.max(0, parseNumber(getParam(req, 'from'), 0));
  const regex = getParam(req, 'regex') === 'true';
  const caseSensitive = getParam(req, 'caseSensitive') === 'true';

  let line: number;
  try {
    line = logManager.search(
      file,
      query,
      from,
      direction === 'forward',
      regex,
      caseSensitive,
      mask,
    );
  } catch (e) {
    const message = String(e);
    if (message.indexOf(INVALID_REGEX_MARKER) >= 0) {
      return errorResponse(
        400,
        message.slice(message.indexOf(INVALID_REGEX_MARKER)),
        'VALIDATION_ERROR',
      );
    }
    return errorResponse(500, message, 'INTERNAL_ERROR');
  }

  if (line === NOT_FOUND) return notFound(file);
  if (line === SEARCH_STALE) {
    return errorResponse(
      409,
      'Search stopped: the log file changed while it was being scanned',
      'SEARCH_STALE',
    );
  }
  if (line === SEARCH_ABORTED) {
    return errorResponse(
      400,
      'Search stopped: the pattern took too long to evaluate',
      'SEARCH_TIMEOUT',
    );
  }
  return jsonResponse<LogSearchResult>({ line: line === NO_MATCH ? null : line });
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
    if (action === 'locate') return locateLine(req, file, mask);
    if (action === 'download') return downloadFile(file);
    return errorResponse(400, `Unknown action '${action}'`, 'VALIDATION_ERROR');
  } catch (e) {
    return errorResponse(500, String(e), 'INTERNAL_ERROR');
  }
}
