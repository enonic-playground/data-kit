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
const MAX_READ_BYTES = 100 * 1024 * 1024;
const MATCH_SLICE_MS = 750;
const MAX_MATCH_SCANS = 4;
const MAX_CACHED_INDEXES = 4;
const MAX_WINDOW_MINUTES = 7 * 24 * 60;
const MILLIS_PER_MINUTE = 60_000;
const MILLIS_PER_DAY = 86_400_000;
const TIME_LENGTH = 12;
const DATE_LENGTH = 11;
const NO_TIME = -1;
const HEAD_CAPACITY = 512;

// ? Classification decodes the line head and reuses the client's own pattern rather than
// ? matching bytes the way LogManager.kt does — the harness owes the API parity, not the
// ? implementation. Codes and bit positions do have to match.
const ENTRY_PREFIX =
  /^((?:\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}:\d{2}[.,]\d{3}) (TRACE|DEBUG|INFO|WARN|ERROR)\s+(\S{1,256}) - /;
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

// Where a time window begins. Both 0 and null when the whole file is inside it.
type LogWindow = {
  line: number;
  time: string | null;
};

type LogLocation = {
  position: number;
  visible: boolean;
};

type LogMatchCount = {
  total: number;
  levels: number[];
  scanned: number;
  lines: number;
  complete: boolean;
};

type LogSearchResult = LogMatchCount & {
  line: number | null;
  ordinal: number | null;
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
  matchScans: MatchScan[];
};

// One query's scan of one file, most-recent first. Not an MRU of one: two readers counting
// different queries on the same file would evict each other every slice and neither would finish.
type MatchScan = {
  key: string;
  lines: Int32Array;
  count: number;
  scanned: number;
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
    matchScans: [],
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

// `start` clamped to a line this file has.
function windowFloor(index: LineIndex, start: number): number {
  return Math.min(Math.max(0, start), index.count);
}

// First position in `filtered` at or after physical line `floor`. Applied here rather than
// folded into `filtered`, which only ever grows at its end.
function filteredFloor(index: LineIndex, floor: number): number {
  if (floor <= 0) return 0;

  let low = 0;
  let high = index.filteredCount;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (index.filtered[mid] < floor) low = mid + 1;
    else high = mid;
  }
  return low;
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

// Time an entry head declares, or NO_TIME when the line is a continuation. Dated entries report
// milliseconds since the epoch, undated ones milliseconds into the day. Built on ENTRY_PREFIX so
// the window and the level index cannot disagree about what an entry is.
function entryMillis(line: string): number {
  const match = ENTRY_PREFIX.exec(line);
  if (match == null) return NO_TIME;

  const stamp = match[1];
  const dated = stamp.length > TIME_LENGTH;
  const time = dated ? stamp.slice(DATE_LENGTH) : stamp;
  const ofDay =
    Number(time.slice(0, 2)) * 3_600_000 +
    Number(time.slice(3, 5)) * 60_000 +
    Number(time.slice(6, 8)) * 1000 +
    Number(time.slice(9, 12));

  if (!dated) return ofDay;
  return (
    Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(5, 7)) - 1, Number(stamp.slice(8, 10))) +
    ofDay
  );
}

function timeText(value: number): string {
  const pad = (part: number, width: number): string => String(part).padStart(width, '0');
  const ofDay = value % MILLIS_PER_DAY;
  const hours = pad(Math.floor(ofDay / 3_600_000), 2);
  const minutes = pad(Math.floor(ofDay / 60_000) % 60, 2);
  const seconds = pad(Math.floor(ofDay / 1000) % 60, 2);
  const time = `${hours}:${minutes}:${seconds}.${pad(ofDay % 1000, 3)}`;

  if (value < MILLIS_PER_DAY) return time;
  return `${new Date(value).toISOString().slice(0, 10)} ${time}`;
}

// Entry time in effect at `line` — its own, or that of the entry it continues. NO_TIME only
// when no entry head sits above it at all: capping the walk would return NO_TIME for the tail
// of a long stack trace, which resolveWindow reads as "older than the cutoff", putting a false
// in the middle of the sorted array its binary search assumes.
function effectiveMillis(file: string, index: LineIndex, line: number): number {
  for (let at = line; at >= 0; at -= 1) {
    const [text] = readLines(file, index, at, 1);
    if (text == null) return NO_TIME;
    const millis = entryMillis(text);
    if (millis !== NO_TIME) return millis;
  }
  return NO_TIME;
}

// Time of the file's first entry, which is what says whether its times ascend at all.
function firstEntryMillis(file: string, index: LineIndex): number {
  for (let at = 0; at < index.count; at += 1) {
    const [text] = readLines(file, index, at, 1);
    if (text == null) return NO_TIME;
    const millis = entryMillis(text);
    if (millis !== NO_TIME) return millis;
  }
  return NO_TIME;
}

// Physical line the last `minutes` of the file begin at, anchored to its last entry rather than
// to the clock: a log line carries no date, so nothing orders two of them across midnight.
//
// The line it lands on is always an entry head — a continuation carries the time of the entry
// above it, which is earlier in the file and so would have been found first.
function resolveWindow(file: string, index: LineIndex, minutes: number): LogWindow {
  if (index.count === 0) return { line: 0, time: null };

  const anchor = effectiveMillis(file, index, index.count - 1);
  if (anchor === NO_TIME) return { line: 0, time: null };

  const span = minutes * MILLIS_PER_MINUTE;
  if (span >= anchor) return { line: 0, time: null };

  // A file written across midnight holds times that fall rather than rise, and the search below
  // is a binary one. An opening entry later in the day than the closing one is that file; with
  // no date in a log line to order the halves by, the honest answer is to cut nothing.
  const first = firstEntryMillis(file, index);
  if (first === NO_TIME || first > anchor) return { line: 0, time: null };

  const cutoff = anchor - span;
  let low = 0;
  let high = index.count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const millis = effectiveMillis(file, index, mid);
    if (millis === NO_TIME || millis < cutoff) low = mid + 1;
    else high = mid;
  }

  if (low <= 0) return { line: 0, time: null };

  const millis = effectiveMillis(file, index, low);
  return { line: low, time: millis === NO_TIME ? null : timeText(millis) };
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
  mask: number,
  floor: number,
): number | null {
  if (index.count === 0) return null;

  const filtering = isFiltering(mask);
  const admits = (line: number): boolean =>
    line >= floor && (!filtering || (mask & (1 << index.levels[line])) !== 0);

  if (forward) {
    let cursor = Math.max(floor, from);
    while (cursor < index.count) {
      const lines = readLines(file, index, cursor, blockLines(index, cursor));
      if (lines.length === 0) break;
      for (let i = 0; i < lines.length; i += 1) {
        if (admits(cursor + i) && matcher(lines[i])) return cursor + i;
      }
      cursor += lines.length;
    }
    return null;
  }

  let end = Math.min(from, index.count - 1);
  while (end >= floor) {
    const start = blockStart(index, end);
    const lines = readLines(file, index, start, end - start + 1);
    if (lines.length === 0) break;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (admits(start + i) && matcher(lines[i])) return start + i;
    }
    end = start - 1;
  }
  return null;
}

// The level mask is deliberately not part of the key: matches are physical line numbers and a
// filter is applied when the index is read, so toggling a level never discards a scan.
function matchKeyOf(query: string, regex: boolean, caseSensitive: boolean): string {
  return `${regex ? 'r' : 'p'}${caseSensitive ? 's' : 'i'}\u0000${query}`;
}

// Lines the match scan may cover: every line the file has terminated. A trailing line still
// being written is left out, because the bytes still to come can change what it matches.
function matchLimit(index: LineIndex): number {
  return index.expectLineStart ? index.count : Math.max(0, index.count - 1);
}

// The scan for one key, promoted to most-recent, or null when the file already holds as many
// unfinished scans as it will. Only a finished scan is evicted: dropping one still in progress
// makes a set of readers restart each other from line 0 and never reach a total.
function openScan(index: LineIndex, key: string): MatchScan | null {
  const existing = index.matchScans.find((scan) => scan.key === key);
  if (existing != null) {
    index.matchScans = [existing, ...index.matchScans.filter((scan) => scan !== existing)];
    return existing;
  }

  if (index.matchScans.length >= MAX_MATCH_SCANS) {
    const limit = matchLimit(index);
    const done = index.matchScans.findLast((scan) => scan.scanned >= limit);
    if (done == null) return null;
    index.matchScans = index.matchScans.filter((scan) => scan !== done);
  }

  const fresh: MatchScan = { key, lines: new Int32Array(0), count: 0, scanned: 0 };
  index.matchScans = [fresh, ...index.matchScans];
  return fresh;
}

function findScan(index: LineIndex, key: string): MatchScan | undefined {
  return index.matchScans.find((scan) => scan.key === key);
}

// Extends one key's scan by up to MATCH_SLICE_MS of scanning, and stops. The client re-calls
// while `complete` is false, so the request loop is the scheduler.
function matchSlice(file: string, index: LineIndex, matcher: Matcher, key: string): boolean {
  const scan = openScan(index, key);
  if (scan == null) return false;

  const limit = matchLimit(index);
  const deadline = Date.now() + MATCH_SLICE_MS;

  while (scan.scanned < limit) {
    const cursor = scan.scanned;
    const lines = readLines(file, index, cursor, blockLines(index, cursor));
    if (lines.length === 0) break;

    for (let i = 0; i < lines.length; i += 1) {
      if (cursor + i >= limit) break;
      if (!matcher(lines[i])) continue;
      if (scan.count === scan.lines.length) {
        const grown = new Int32Array(scan.lines.length === 0 ? 1024 : scan.lines.length * 2);
        grown.set(scan.lines);
        scan.lines = grown;
      }
      scan.lines[scan.count] = cursor + i;
      scan.count += 1;
    }

    scan.scanned = Math.min(cursor + lines.length, limit);

    // Checked after a block, as LogManager.matchSlice does: a deadline shorter than one block
    // would hand back having scanned nothing, and the client re-calls until the scan is done.
    if (Date.now() >= deadline) break;
  }

  return true;
}

// `scanned` and `complete` stay whole-file: they describe the scan, which a window never
// narrows, and a client polling on them would otherwise stop short.
function matchProgress(index: LineIndex, key: string, floor: number): LogMatchCount {
  const levels = [0, 0, 0, 0, 0, 0];
  const scan = findScan(index, key);
  let first = 0;
  if (scan != null) {
    while (first < scan.count && scan.lines[first] < floor) first += 1;
    for (let i = first; i < scan.count; i += 1) levels[index.levels[scan.lines[i]]] += 1;
  }

  return {
    total: scan == null ? 0 : scan.count - first,
    levels,
    scanned: scan?.scanned ?? 0,
    lines: index.count,
    complete: scan != null && scan.scanned >= matchLimit(index),
  };
}

// Zero-based position of `line` among the matches `mask` admits, or null when the scan has not
// reached it. A walk rather than a binary search: the mask hides an arbitrary subset.
function ordinalOf(
  index: LineIndex,
  key: string,
  mask: number,
  line: number,
  floor: number,
): number | null {
  const scan = findScan(index, key);
  if (scan == null || line >= scan.scanned) return null;

  const filtering = isFiltering(mask);
  let ordinal = 0;
  for (let i = 0; i < scan.count; i += 1) {
    const match = scan.lines[i];
    if (match < floor) continue;
    if (match >= line) break;
    if (!filtering || (mask & (1 << index.levels[match])) !== 0) ordinal += 1;
  }
  return ordinal;
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

function handleInfo(res: ServerResponse, resolved: Resolved, mask: number, start: number): void {
  const index = getIndex(resolved.file, resolved.size, resolved.mtimeMs);
  const info: LogInfo = {
    name: resolved.name,
    size: resolved.size,
    modified: new Date(resolved.mtimeMs).toISOString(),
    lines: index.count,
    levels: levelCounts(index),
  };

  // `filtered` is the size of the view, whichever of the two narrows it.
  const floor = windowFloor(index, start);
  if (isFiltering(mask)) {
    filteredIndex(index, mask);
    info.filtered = index.filteredCount - filteredFloor(index, floor);
  } else if (floor > 0) {
    info.filtered = index.count - floor;
  }
  sendData(res, info);
}

function handleWindow(res: ServerResponse, resolved: Resolved, params: URLSearchParams): void {
  const minutes = toInt(params.get('minutes'), 0);
  if (minutes < 1 || minutes > MAX_WINDOW_MINUTES) {
    sendError(res, 400, `minutes must be between 1 and ${MAX_WINDOW_MINUTES}`, 'VALIDATION_ERROR');
    return;
  }

  const index = getIndex(resolved.file, resolved.size, resolved.mtimeMs);
  sendData(res, resolveWindow(resolved.file, index, minutes));
}

// Mirrors the server's read cap: 1000 lines of 200 KB would otherwise materialize 200 MB.
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
  start: number,
): void {
  const from = Math.max(0, toInt(params.get('from'), 0));
  const count = Math.min(MAX_COUNT, Math.max(1, toInt(params.get('count'), DEFAULT_COUNT)));
  const index = getIndex(resolved.file, resolved.size, resolved.mtimeMs);
  const floor = windowFloor(index, start);

  if (!isFiltering(mask)) {
    const total = index.count - floor;
    const fromLine = floor + Math.min(from, total);
    const taken = budgetedCount(index, fromLine, count, MAX_READ_BYTES);
    const lines: LogLines = {
      from,
      lines: readLines(resolved.file, index, fromLine, taken),
      total,
      size: resolved.size,
    };
    // A window makes the row index stop being the line number, so the numbers travel with the
    // lines exactly as they do under a level filter.
    if (floor > 0) {
      lines.numbers = Array.from({ length: taken }, (_, i) => fromLine + i);
    }
    sendData(res, lines);
    return;
  }

  filteredIndex(index, mask);
  const base = filteredFloor(index, floor);
  const first = base + Math.min(from, index.filteredCount - base);
  const end = Math.min(first + count, index.filteredCount);
  const numbers: number[] = [];
  for (let i = first; i < end; i += 1) numbers.push(index.filtered[i]);

  const read = readRuns(resolved.file, index, numbers);
  const lines: LogLines = {
    from,
    lines: read,
    numbers: numbers.slice(0, read.length),
    total: index.filteredCount - base,
    size: resolved.size,
  };
  sendData(res, lines);
}

function handleLocate(
  res: ServerResponse,
  resolved: Resolved,
  params: URLSearchParams,
  mask: number,
  start: number,
): void {
  const raw = params.get('line');
  if (raw == null || raw === '') {
    sendError(res, 400, 'line is required', 'VALIDATION_ERROR');
    return;
  }

  const line = Math.max(0, toInt(raw, 0));
  const index = getIndex(resolved.file, resolved.size, resolved.mtimeMs);
  const floor = windowFloor(index, start);

  if (!isFiltering(mask)) {
    if (index.count <= floor) {
      sendData(res, { position: 0, visible: false } satisfies LogLocation);
      return;
    }
    const location: LogLocation = {
      position: Math.min(Math.max(line, floor), index.count - 1) - floor,
      visible: line >= floor,
    };
    sendData(res, location);
    return;
  }

  filteredIndex(index, mask);
  const base = filteredFloor(index, floor);
  if (index.filteredCount <= base) {
    sendData(res, { position: 0, visible: false } satisfies LogLocation);
    return;
  }

  let low = base;
  let high = index.filteredCount;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (index.filtered[mid] < line) low = mid + 1;
    else high = mid;
  }

  if (low < index.filteredCount && index.filtered[low] === line) {
    sendData(res, { position: low - base, visible: true } satisfies LogLocation);
    return;
  }

  // A hidden line is usually a stack frame of the entry above it.
  const nearest = low > base ? low - 1 : base;
  sendData(res, { position: nearest - base, visible: false } satisfies LogLocation);
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

// What every scanning action needs from the request, or null once it has answered it.
type Scan = { matcher: Matcher; indexKey: string };

function requireScan(res: ServerResponse, params: URLSearchParams): Scan | null {
  const query = params.get('query');
  if (query == null || query === '') {
    sendError(res, 400, 'query is required', 'VALIDATION_ERROR');
    return null;
  }
  if (query.length > MAX_QUERY_LENGTH) {
    sendError(res, 400, `query exceeds ${MAX_QUERY_LENGTH} characters`, 'VALIDATION_ERROR');
    return null;
  }

  const regex = params.get('regex') === 'true';
  const matchCase = params.get('caseSensitive') === 'true';

  try {
    return {
      matcher: createMatcher(query, regex, matchCase),
      indexKey: matchKeyOf(query, regex, matchCase),
    };
  } catch (e) {
    sendError(res, 400, `Invalid regular expression: ${String(e)}`, 'VALIDATION_ERROR');
    return null;
  }
}

function handleSearch(
  res: ServerResponse,
  resolved: Resolved,
  params: URLSearchParams,
  mask: number,
  start: number,
): void {
  const scan = requireScan(res, params);
  if (scan == null) return;

  const direction = params.get('direction') ?? 'forward';
  if (direction !== 'forward' && direction !== 'backward') {
    sendError(res, 400, 'direction must be forward or backward', 'VALIDATION_ERROR');
    return;
  }

  const forward = direction === 'forward';
  const index = getIndex(resolved.file, resolved.size, resolved.mtimeMs);
  const from = Math.max(0, toInt(params.get('from'), 0));
  const floor = windowFloor(index, start);

  const line = searchIndex(resolved.file, index, scan.matcher, from, forward, mask, floor);

  sendData(res, {
    ...matchProgress(index, scan.indexKey, floor),
    line,
    ordinal: line == null ? null : ordinalOf(index, scan.indexKey, mask, line, floor),
  } satisfies LogSearchResult);
}

function handleMatches(
  res: ServerResponse,
  resolved: Resolved,
  params: URLSearchParams,
  start: number,
): void {
  const scan = requireScan(res, params);
  if (scan == null) return;

  const index = getIndex(resolved.file, resolved.size, resolved.mtimeMs);
  if (!matchSlice(resolved.file, index, scan.matcher, scan.indexKey)) {
    sendError(res, 503, 'Too many searches running; try again', 'SEARCH_BUSY');
    return;
  }

  sendData(res, matchProgress(index, scan.indexKey, windowFloor(index, start)));
}

// A windowed download is a different file from the one it was cut out of, so it is named for
// the line it starts on, in the 1-based numbering the viewer's gutter shows.
function downloadName(name: string, start: number): string {
  if (start <= 0) return name;
  return `${name.slice(0, -'.log'.length)}.from-${start + 1}.log`;
}

function handleDownload(res: ServerResponse, resolved: Resolved, start: number): void {
  const index = getIndex(resolved.file, resolved.size, resolved.mtimeMs);
  const floor = windowFloor(index, start);
  const offset = floor >= index.count ? resolved.size : index.offsets[floor];
  const length = Math.max(0, resolved.size - offset);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', length);
  // Named from the raw `start`, as the server does — it has no line index to clamp against.
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${downloadName(resolved.name, start)}"`,
  );
  // Bounded at both ends: a live file grows during the download, and Content-Length above is
  // already committed to the size read now.
  if (length === 0) {
    res.end();
    return;
  }
  createReadStream(resolved.file, { start: offset, end: offset + length - 1 }).pipe(res);
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

  const start = Math.max(0, toInt(params.get('start'), 0));

  if (action == null) {
    handleRead(res, resolved, params, mask, start);
    return;
  }
  if (action === 'window') {
    handleWindow(res, resolved, params);
    return;
  }
  if (action === 'info') {
    handleInfo(res, resolved, mask, start);
    return;
  }
  if (action === 'search') {
    handleSearch(res, resolved, params, mask, start);
    return;
  }
  if (action === 'matches') {
    handleMatches(res, resolved, params, start);
    return;
  }
  if (action === 'locate') {
    handleLocate(res, resolved, params, mask, start);
    return;
  }
  if (action === 'download') {
    handleDownload(res, resolved, start);
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
