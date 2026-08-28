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

// ? The bean throws IllegalArgumentException carrying this prefix for a rejected pattern.
const INVALID_REGEX_MARKER = 'Invalid regular expression';

const NOT_FOUND = -2;
const NO_MATCH = -1;
const SEARCH_ABORTED = -3;

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

//
// * Handlers
//

function listFiles(): Response {
  const files = JSON.parse(logManager.list()) as LogFile[];
  return jsonResponse({ files });
}

function readInfo(file: string): Response {
  const json = logManager.info(file);
  if (json == null) return notFound(file);
  return jsonResponse(JSON.parse(json) as LogInfo);
}

function readLines(req: Request, file: string): Response {
  const from = Math.max(0, parseNumber(getParam(req, 'from'), 0));
  const count = clamp(parseNumber(getParam(req, 'count'), DEFAULT_COUNT), MIN_COUNT, MAX_COUNT);

  const json = logManager.read(file, from, count);
  if (json == null) return notFound(file);
  return jsonResponse(JSON.parse(json) as LogLines);
}

function searchLines(req: Request, file: string): Response {
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
    line = logManager.search(file, query, from, direction === 'forward', regex, caseSensitive);
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

  try {
    if (action == null) return readLines(req, file);
    if (action === 'info') return readInfo(file);
    if (action === 'search') return searchLines(req, file);
    if (action === 'download') return downloadFile(file);
    return errorResponse(400, `Unknown action '${action}'`, 'VALIDATION_ERROR');
  } catch (e) {
    return errorResponse(500, String(e), 'INTERNAL_ERROR');
  }
}
