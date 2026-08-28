import { closeSync, createReadStream, openSync, readdirSync, readSync, statSync } from 'node:fs';
import path from 'node:path';

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite-plus';

//
// * Contract
//

const API_PREFIX = '/dev-api';
const LOGS_PATH = `${API_PREFIX}/logs`;
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.log$/;
const ROTATED_FILE_NAME_PATTERN = /^.+\.\d{4}-\d{2}-\d{2}\.\d+\.log$/;
const DEFAULT_COUNT = 200;
const MAX_COUNT = 1000;
const MAX_QUERY_LENGTH = 500;
const MAX_LEVELS_LENGTH = 64;

const NEWLINE = 0x0a;
const SCAN_BUFFER_BYTES = 1024 * 1024;
const SEARCH_BLOCK_LINES = 2048;
const SEARCH_BLOCK_BYTES = 4 * 1024 * 1024;
const MAX_READ_BYTES = 20 * 1024 * 1024;
const MAX_CACHED_INDEXES = 4;
const HEAD_CAPACITY = 512;

// ? Classification decodes the line head and reuses the client's own pattern rather than
// ? matching bytes the way LogManager.kt does — the harness owes the API parity, not the
// ? implementation. Codes and bit positions do have to match.
const ENTRY_PREFIX = /^(\d{2}:\d{2}:\d{2}\.\d{3}) (TRACE|DEBUG|INFO|WARN|ERROR)\s+(\S{1,256}) - /;
const LEVEL_CODES: Record<string, number | undefined> = {
  TRACE: 1,
  DEBUG: 2,
  INFO: 3,
  WARN: 4,
  ERROR: 5,
};
const LEVEL_UNKNOWN = 0;
const LEVEL_MASK_ALL = 0b111110;
const NO_FILTER = 0;
const INVALID_LEVELS = -1;

type LogFile = {
  name: string;
  size: number;
  modified: string;
  active: boolean;
  rotated: boolean;
};

type LogLevelCounts = {
  unknown: number;
  trace: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
};

type LogInfo = {
  name: string;
  size: number;
  modified: string;
  lines: number;
  levels: LogLevelCounts;
  filtered?: number;
};

type LogLines = {
  from: number;
  lines: string[];
  numbers?: number[];
  total: number;
  size: number;
};

type LogLocation = {
  position: number;
  visible: boolean;
};

//
// * Line Index
//

type LineIndex = {
  offsets: Float64Array;
  levels: Uint8Array;
  count: number;
  scanned: number;
  expectLineStart: boolean;
  size: number;
  mtimeMs: number;
  head: Buffer;
  headLength: number;
  levelCarry: number;
  filtered: Int32Array;
  filteredCount: number;
  filteredScanned: number;
  maskCached: number;
};

const indexes = new Map<string, LineIndex>();

function createIndex(): LineIndex {
  return {
    offsets: new Float64Array(1024),
    levels: new Uint8Array(1024),
    count: 0,
    scanned: 0,
    expectLineStart: true,
    size: 0,
    mtimeMs: 0,
    head: Buffer.allocUnsafe(HEAD_CAPACITY),
    headLength: 0,
    levelCarry: LEVEL_UNKNOWN,
    filtered: new Int32Array(0),
    filteredCount: 0,
    filteredScanned: 0,
    maskCached: -1,
  };
}

function pushLine(index: LineIndex, offset: number): void {
  if (index.count === index.offsets.length) {
    const grownOffsets = new Float64Array(index.offsets.length * 2);
    grownOffsets.set(index.offsets);
    index.offsets = grownOffsets;
    const grownLevels = new Uint8Array(index.levels.length * 2);
    grownLevels.set(index.levels);
    index.levels = grownLevels;
  }
  index.offsets[index.count] = offset;
  index.levels[index.count] = LEVEL_UNKNOWN;
  index.count += 1;
}

function captureHead(index: LineIndex, view: Buffer, from: number, to: number): void {
  const room = HEAD_CAPACITY - index.headLength;
  if (room <= 0) return;
  const length = Math.min(to - from, room);
  view.copy(index.head, index.headLength, from, from + length);
  index.headLength += length;
}

// A line declaring no level of its own belongs to the entry above it.
function classifyLine(index: LineIndex, advanceCarry: boolean): void {
  if (index.count === 0) return;
  const match = ENTRY_PREFIX.exec(index.head.subarray(0, index.headLength).toString('utf8'));
  const own = match === null ? LEVEL_UNKNOWN : (LEVEL_CODES[match[2]] ?? LEVEL_UNKNOWN);
  const effective = own === LEVEL_UNKNOWN ? index.levelCarry : own;
  index.levels[index.count - 1] = effective;
  if (advanceCarry) index.levelCarry = effective;
}

function isFiltering(mask: number): boolean {
  return mask > 0 && (mask & LEVEL_MASK_ALL) !== LEVEL_MASK_ALL;
}

function filteredIndex(index: LineIndex, mask: number): void {
  if (mask !== index.maskCached) {
    index.maskCached = mask;
    index.filteredCount = 0;
    index.filteredScanned = 0;
  } else if (index.filteredScanned > 0) {
    // The trailing line is reclassified as the file grows, so redo the last one folded in.
    index.filteredScanned -= 1;
    while (
      index.filteredCount > 0 &&
      index.filtered[index.filteredCount - 1] >= index.filteredScanned
    ) {
      index.filteredCount -= 1;
    }
  }

  while (index.filteredScanned < index.count) {
    if ((mask & (1 << index.levels[index.filteredScanned])) !== 0) {
      if (index.filteredCount === index.filtered.length) {
        const grown = new Int32Array(
          index.filtered.length === 0 ? 1024 : index.filtered.length * 2,
        );
        grown.set(index.filtered);
        index.filtered = grown;
      }
      index.filtered[index.filteredCount] = index.filteredScanned;
      index.filteredCount += 1;
    }
    index.filteredScanned += 1;
  }
}

function levelCounts(index: LineIndex): LogLevelCounts {
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < index.count; i += 1) counts[index.levels[i]] += 1;
  return {
    unknown: counts[0],
    trace: counts[1],
    debug: counts[2],
    info: counts[3],
    warn: counts[4],
    error: counts[5],
  };
}

function scan(index: LineIndex, file: string, size: number): void {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(SCAN_BUFFER_BYTES);
    let pos = index.scanned;
    while (pos < size) {
      const read = readSync(fd, buffer, 0, Math.min(SCAN_BUFFER_BYTES, size - pos), pos);
      if (read <= 0) break;
      const view = buffer.subarray(0, read);
      let i = 0;
      while (i < read) {
        if (index.expectLineStart) {
          pushLine(index, pos + i);
          index.expectLineStart = false;
          index.headLength = 0;
        }
        const newline = view.indexOf(NEWLINE, i);
        captureHead(index, view, i, newline < 0 ? read : newline);
        if (newline < 0) break;
        classifyLine(index, true);
        index.expectLineStart = true;
        i = newline + 1;
      }
      pos += read;
      index.scanned = pos;
    }
    // The trailing line of a live file has no newline yet: classify it provisionally and
    // leave the carry, since the bytes still to come can turn it into an entry.
    if (!index.expectLineStart) classifyLine(index, false);
  } finally {
    closeSync(fd);
  }
}

function getIndex(file: string, size: number, mtimeMs: number): LineIndex {
  const cached = indexes.get(file);
  const stale =
    cached != null &&
    (size < cached.scanned || (size === cached.scanned && mtimeMs !== cached.mtimeMs));
  const index = cached == null || stale ? createIndex() : cached;

  if (size > index.scanned) scan(index, file, size);
  index.size = size;
  index.mtimeMs = mtimeMs;

  indexes.delete(file);
  indexes.set(file, index);
  while (indexes.size > MAX_CACHED_INDEXES) {
    const oldest = indexes.keys().next();
    if (oldest.done === true) break;
    indexes.delete(oldest.value);
  }

  return index;
}

function readLines(file: string, index: LineIndex, from: number, count: number): string[] {
  if (from >= index.count) return [];

  const end = Math.min(from + count, index.count);
  const start = index.offsets[from];
  const stop = end < index.count ? index.offsets[end] : index.size;
  const length = stop - start;
  if (length <= 0) return [];

  const buffer = Buffer.allocUnsafe(length);
  const fd = openSync(file, 'r');
  try {
    let filled = 0;
    while (filled < length) {
      const read = readSync(fd, buffer, filled, length - filled, start + filled);
      if (read <= 0) break;
      filled += read;
    }
    let text = buffer.subarray(0, filled).toString('utf8');
    if (text.endsWith('\n')) text = text.slice(0, -1);
    return text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  } finally {
    closeSync(fd);
  }
}

// Keeps a search block under both caps; a file with 200 KB lines would otherwise read 400 MB.
function blockLines(index: LineIndex, from: number): number {
  const start = index.offsets[from];
  let lines = Math.min(SEARCH_BLOCK_LINES, index.count - from);
  while (lines > 1) {
    const stop = from + lines < index.count ? index.offsets[from + lines] : index.size;
    if (stop - start <= SEARCH_BLOCK_BYTES) break;
    lines = Math.floor(lines / 2);
  }
  return lines;
}

function blockStart(index: LineIndex, end: number): number {
  const stop = end + 1 < index.count ? index.offsets[end + 1] : index.size;
  let lines = Math.min(SEARCH_BLOCK_LINES, end + 1);
  while (lines > 1) {
    if (stop - index.offsets[end - lines + 1] <= SEARCH_BLOCK_BYTES) break;
    lines = Math.floor(lines / 2);
  }
  return end - lines + 1;
}

type Matcher = (line: string) => boolean;

// ? JS RegExp, not java.util.regex: a harness-only mismatch on exotic patterns (\p{...}, \h, ...)
function createMatcher(query: string, regex: boolean, caseSensitive: boolean): Matcher {
  if (regex) {
    const compiled = new RegExp(query, caseSensitive ? 'u' : 'iu');
    return (line) => compiled.test(line);
  }
  if (caseSensitive) return (line) => line.includes(query);
  const needle = query.toLowerCase();
  return (line) => line.toLowerCase().includes(needle);
}

function searchIndex(
  file: string,
  index: LineIndex,
  matcher: Matcher,
  from: number,
  forward: boolean,
): number | null {
  if (index.count === 0) return null;

  if (forward) {
    let cursor = Math.max(0, from);
    while (cursor < index.count) {
      const lines = readLines(file, index, cursor, blockLines(index, cursor));
      if (lines.length === 0) break;
      for (let i = 0; i < lines.length; i += 1) {
        if (matcher(lines[i])) return cursor + i;
      }
      cursor += lines.length;
    }
    return null;
  }

  let end = Math.min(from, index.count - 1);
  while (end >= 0) {
    const start = blockStart(index, end);
    const lines = readLines(file, index, start, end - start + 1);
    if (lines.length === 0) break;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (matcher(lines[i])) return start + i;
    }
    end = start - 1;
  }
  return null;
}

//
// * Responses
//

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function sendData(res: ServerResponse, data: unknown): void {
  sendJson(res, 200, { data });
}

function sendError(res: ServerResponse, status: number, message: string, code: string): void {
  sendJson(res, status, { status, message, code });
}

//
// * Logs Directory
//

function logsDir(): string {
  return path.resolve(process.env.DATAKIT_LOGS_DIR ?? 'dev/fixtures/logs');
}

function newest(files: LogFile[]): LogFile | null {
  let best: LogFile | null = null;
  for (const file of files) {
    if (best == null || Date.parse(file.modified) > Date.parse(best.modified)) best = file;
  }
  return best;
}

function listFiles(dir: string): LogFile[] {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && FILE_NAME_PATTERN.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const files = names.map((name) => {
    const stat = statSync(path.join(dir, name));
    return {
      name,
      size: stat.size,
      modified: new Date(stat.mtimeMs).toISOString(),
      active: false,
      rotated: ROTATED_FILE_NAME_PATTERN.test(name),
    };
  });

  const active =
    newest(files.filter((file) => !ROTATED_FILE_NAME_PATTERN.test(file.name))) ?? newest(files);
  if (active != null) {
    active.active = true;
    active.rotated = false;
  }

  return files.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return Date.parse(b.modified) - Date.parse(a.modified);
  });
}

type Resolved = {
  file: string;
  name: string;
  size: number;
  mtimeMs: number;
};

function resolveFile(res: ServerResponse, dir: string, name: string | null): Resolved | null {
  if (name == null || name === '') {
    sendError(res, 400, 'file is required', 'VALIDATION_ERROR');
    return null;
  }
  if (!FILE_NAME_PATTERN.test(name)) {
    sendError(res, 400, `file '${name}' is invalid`, 'VALIDATION_ERROR');
    return null;
  }

  const file = path.join(dir, name);
  if (path.dirname(file) !== dir) {
    sendError(res, 400, `file '${name}' is invalid`, 'VALIDATION_ERROR');
    return null;
  }

  try {
    const stat = statSync(file);
    if (!stat.isFile()) {
      sendError(res, 404, `Log '${name}' not found`, 'NOT_FOUND');
      return null;
    }
    return { file, name, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    sendError(res, 404, `Log '${name}' not found`, 'NOT_FOUND');
    return null;
  }
}

//
// * Handlers
//

function toInt(value: string | null, fallback: number): number {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function handleInfo(res: ServerResponse, resolved: Resolved, mask: number): void {
  const index = getIndex(resolved.file, resolved.size, resolved.mtimeMs);
  const info: LogInfo = {
    name: resolved.name,
    size: resolved.size,
    modified: new Date(resolved.mtimeMs).toISOString(),
    lines: index.count,
    levels: levelCounts(index),
  };
  if (isFiltering(mask)) {
    filteredIndex(index, mask);
    info.filtered = index.filteredCount;
  }
  sendData(res, info);
}

// Mirrors the server's read cap: 256 lines of 200 KB would otherwise materialize 50 MB.
function budgetedCount(index: LineIndex, from: number, count: number, maxBytes: number): number {
  if (from >= index.count) return 0;

  const limit = Math.min(from + count, index.count);
  const start = index.offsets[from];
  let end = from;
  while (end < limit) {
    const stop = end + 1 < index.count ? index.offsets[end + 1] : index.size;
    if (stop - start > maxBytes) break;
    end += 1;
  }
  return end - from;
}

// An entry and its stack frames are adjacent, so two hits far apart never pull the bytes
// between them.
function readRuns(file: string, index: LineIndex, numbers: number[]): string[] {
  const lines: string[] = [];
  let budget = MAX_READ_BYTES;
  let runStart = 0;

  for (let i = 1; i <= numbers.length; i += 1) {
    if (i < numbers.length && numbers[i] === numbers[i - 1] + 1) continue;

    const first = numbers[runStart];
    const last = numbers[i - 1];
    const count = budgetedCount(index, first, last - first + 1, budget);
    if (count === 0) return lines;

    lines.push(...readLines(file, index, first, count));
    const stop = first + count < index.count ? index.offsets[first + count] : index.size;
    budget -= stop - index.offsets[first];
    if (first + count <= last) return lines;

    runStart = i;
  }

  return lines;
}

function handleRead(
  res: ServerResponse,
  resolved: Resolved,
  params: URLSearchParams,
  mask: number,
): void {
  const from = Math.max(0, toInt(params.get('from'), 0));
  const count = Math.min(MAX_COUNT, Math.max(1, toInt(params.get('count'), DEFAULT_COUNT)));
  const index = getIndex(resolved.file, resolved.size, resolved.mtimeMs);

  if (!isFiltering(mask)) {
    const lines: LogLines = {
      from,
      lines: readLines(
        resolved.file,
        index,
        from,
        budgetedCount(index, from, count, MAX_READ_BYTES),
      ),
      total: index.count,
      size: resolved.size,
    };
    sendData(res, lines);
    return;
  }

  filteredIndex(index, mask);
  const start = Math.min(from, index.filteredCount);
  const end = Math.min(start + count, index.filteredCount);
  const numbers: number[] = [];
  for (let i = start; i < end; i += 1) numbers.push(index.filtered[i]);

  const read = readRuns(resolved.file, index, numbers);
  const lines: LogLines = {
    from,
    lines: read,
    numbers: numbers.slice(0, read.length),
    total: index.filteredCount,
    size: resolved.size,
  };
  sendData(res, lines);
}

function handleLocate(
  res: ServerResponse,
  resolved: Resolved,
  params: URLSearchParams,
  mask: number,
): void {
  const raw = params.get('line');
  if (raw == null || raw === '') {
    sendError(res, 400, 'line is required', 'VALIDATION_ERROR');
    return;
  }

  const line = Math.max(0, toInt(raw, 0));
  const index = getIndex(resolved.file, resolved.size, resolved.mtimeMs);

  if (!isFiltering(mask)) {
    const location: LogLocation = {
      position: Math.min(line, Math.max(0, index.count - 1)),
      visible: index.count > 0,
    };
    sendData(res, location);
    return;
  }

  filteredIndex(index, mask);
  if (index.filteredCount === 0) {
    sendData(res, { position: 0, visible: false } satisfies LogLocation);
    return;
  }

  let low = 0;
  let high = index.filteredCount;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (index.filtered[mid] < line) low = mid + 1;
    else high = mid;
  }

  if (low < index.filteredCount && index.filtered[low] === line) {
    sendData(res, { position: low, visible: true } satisfies LogLocation);
    return;
  }

  // A hidden line is usually a stack frame of the entry above it.
  sendData(res, { position: low > 0 ? low - 1 : 0, visible: false } satisfies LogLocation);
}

function parseLevels(value: string | null): number {
  if (value == null || value === '') return NO_FILTER;
  if (value.length > MAX_LEVELS_LENGTH) return INVALID_LEVELS;

  let mask = NO_FILTER;
  for (const name of value.split(',')) {
    const code = LEVEL_CODES[name.toUpperCase()];
    if (code === undefined) return INVALID_LEVELS;
    mask |= 1 << code;
  }
  return mask;
}

function handleSearch(res: ServerResponse, resolved: Resolved, params: URLSearchParams): void {
  const query = params.get('query');
  if (query == null || query === '') {
    sendError(res, 400, 'query is required', 'VALIDATION_ERROR');
    return;
  }
  if (query.length > MAX_QUERY_LENGTH) {
    sendError(res, 400, `query exceeds ${MAX_QUERY_LENGTH} characters`, 'VALIDATION_ERROR');
    return;
  }

  const direction = params.get('direction') ?? 'forward';
  if (direction !== 'forward' && direction !== 'backward') {
    sendError(res, 400, 'direction must be forward or backward', 'VALIDATION_ERROR');
    return;
  }

  const forward = direction === 'forward';
  const index = getIndex(resolved.file, resolved.size, resolved.mtimeMs);
  const from = Math.max(0, toInt(params.get('from'), 0));

  let matcher: Matcher;
  try {
    matcher = createMatcher(
      query,
      params.get('regex') === 'true',
      params.get('caseSensitive') === 'true',
    );
  } catch (e) {
    sendError(res, 400, `Invalid regular expression: ${String(e)}`, 'VALIDATION_ERROR');
    return;
  }

  sendData(res, { line: searchIndex(resolved.file, index, matcher, from, forward) });
}

function handleDownload(res: ServerResponse, resolved: Resolved): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', resolved.size);
  res.setHeader('Content-Disposition', `attachment; filename="${resolved.name}"`);
  createReadStream(resolved.file).pipe(res);
}

function handleLogs(res: ServerResponse, params: URLSearchParams): void {
  const dir = logsDir();
  const name = params.get('file');
  const action = params.get('action');

  if (name == null && action == null) {
    sendData(res, { files: listFiles(dir) });
    return;
  }

  const resolved = resolveFile(res, dir, name);
  if (resolved == null) return;

  const mask = parseLevels(params.get('levels'));
  if (mask === INVALID_LEVELS) {
    sendError(
      res,
      400,
      'levels must be a comma-separated list of TRACE, DEBUG, INFO, WARN and ERROR',
      'VALIDATION_ERROR',
    );
    return;
  }

  if (action == null) {
    handleRead(res, resolved, params, mask);
    return;
  }
  if (action === 'info') {
    handleInfo(res, resolved, mask);
    return;
  }
  if (action === 'search') {
    handleSearch(res, resolved, params);
    return;
  }
  if (action === 'locate') {
    handleLocate(res, resolved, params, mask);
    return;
  }
  if (action === 'download') {
    handleDownload(res, resolved);
    return;
  }

  sendError(res, 400, `Unknown action '${action}'`, 'VALIDATION_ERROR');
}

//
// * Plugin
//

const MOCK_API_NAME = 'datakit-mock-api';

export function mockApi(): Plugin {
  return {
    name: MOCK_API_NAME,
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const raw = req.url ?? '/';
        if (!raw.startsWith(`${API_PREFIX}/`)) {
          next();
          return;
        }

        const url = new URL(raw, 'http://localhost');
        try {
          if (url.pathname === LOGS_PATH) {
            handleLogs(res, url.searchParams);
          } else {
            sendError(res, 404, `Not mocked: ${url.pathname}`, 'NOT_FOUND');
          }
        } catch (e) {
          sendError(res, 500, String(e), 'INTERNAL_ERROR');
        }

        console.log(`  [mock-api] ${req.method} ${raw} -> ${res.statusCode}`);
      });
    },
  };
}
