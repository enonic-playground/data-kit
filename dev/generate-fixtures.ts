import { appendFileSync, closeSync, mkdirSync, openSync, statSync, writeSync } from 'node:fs';
import path from 'node:path';

//
// * Configuration
//

const FIXTURES_DIR = path.resolve('dev/fixtures/logs');
const ACTIVE_LOG = 'server.log';
const ACTIVE_LINES = 300_000;
const ROTATED_LINES = 5_000;
const TAIL_LINES = 180;
const HUGE_LINE_EVERY = 50_000;
const HUGE_LINE_MIN = 100 * 1024;
const FLUSH_BYTES = 4 * 1024 * 1024;
const APPEND_INTERVAL_MS = 500;
const SEED = 0x5eed_1053;

const LEVELS = [
  'TRACE',
  'DEBUG',
  'DEBUG',
  'INFO',
  'INFO',
  'INFO',
  'INFO',
  'WARN',
  'ERROR',
] as const;

const LOGGERS = [
  'c.e.x.web.impl.dispatch.DispatchServlet',
  'c.e.x.core.internal.app.ApplicationServiceImpl',
  'c.e.x.repo.internal.node.NodeServiceImpl',
  'c.e.x.repo.internal.storage.IndexServiceImpl',
  'c.e.x.portal.impl.handler.MappingHandler',
  'c.e.x.script.impl.async.AsyncScheduler',
  'c.e.x.admin.impl.tool.AdminToolHandler',
  'c.e.x.jaxrs.impl.JaxRsServlet',
  'com.enonic.app.datakit.DumpManager',
  'org.elasticsearch.cluster.service',
] as const;

const MESSAGES = [
  'Started application [{app}] in {ms} ms',
  'Node {id} created in repo {repo}, branch {branch}',
  'Query executed in {ms} ms, hits: {n}',
  'Reindexing branch {branch} of repository {repo}',
  'Snapshot {id} completed, {n} shards',
  'Cache evicted {n} entries for {repo}',
  'Received request GET /admin/tool/{app}/main ({ms} ms)',
  'Scheduled task {id} finished with status DONE',
  'Websocket session {id} closed',
  'Índice actualizado — {n} documentos, prüfung ok, 日本語のログ, done 🚀',
  'Content published: /site/artículos/año-2026/über-uns ({n} items)',
] as const;

const WARNINGS = [
  'Slow query detected: {ms} ms for {repo}:{branch}',
  'Application [{app}] is not started, skipping',
  'Retrying connection to elasticsearch node {id} (attempt {n})',
  'Deprecated API used by [{app}], will be removed in XP 9',
] as const;

const ERRORS = [
  'Failed to handle request for /admin/tool/{app}/main',
  'Unable to load node {id} from repository {repo}',
  'Task {id} aborted after {ms} ms',
] as const;

const EXCEPTIONS = [
  'java.lang.NullPointerException: Cannot invoke "com.enonic.xp.node.Node.id()" because "node" is null',
  'com.enonic.xp.node.NodeNotFoundException: Node with id [{id}] not found',
  'java.io.IOException: Broken pipe',
  'java.lang.IllegalArgumentException: Invalid branch name [{branch}]',
] as const;

const FRAMES = [
  'com.enonic.xp.repo.impl.node.NodeServiceImpl.getById(NodeServiceImpl.java:{n})',
  'com.enonic.xp.portal.impl.handler.MappingHandler.doHandle(MappingHandler.java:{n})',
  'com.enonic.xp.web.impl.dispatch.DispatchServlet.service(DispatchServlet.java:{n})',
  'org.eclipse.jetty.server.handler.HandlerWrapper.handle(HandlerWrapper.java:{n})',
  'com.enonic.xp.script.impl.function.ScriptFunctions.execute(ScriptFunctions.java:{n})',
  'java.base/java.lang.Thread.run(Thread.java:{n})',
] as const;

const APPS = [
  'com.enonic.app.datakit',
  'com.enonic.app.contentstudio',
  'com.enonic.xp.app.main',
] as const;
const REPOS = ['com.enonic.cms.default', 'system-repo', 'com.enonic.cms.portal'] as const;
const BRANCHES = ['master', 'draft'] as const;

//
// * Deterministic Randomness
//

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

let random = mulberry32(SEED);

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

function int(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function fill(template: string): string {
  return template
    .replaceAll('{app}', pick(APPS))
    .replaceAll('{repo}', pick(REPOS))
    .replaceAll('{branch}', pick(BRANCHES))
    .replaceAll('{ms}', String(int(1, 8_000)))
    .replaceAll('{n}', String(int(1, 50_000)))
    .replaceAll(
      '{id}',
      `${int(100_000, 999_999).toString(16)}-${int(100_000, 999_999).toString(16)}`,
    );
}

//
// * Log Lines
//

function timestamp(millis: number): string {
  const date = new Date(millis);
  const pad = (value: number, size: number): string => String(value).padStart(size, '0');
  return `${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.${pad(date.getUTCMilliseconds(), 3)}`;
}

function entry(millis: number, level: string, message: string): string {
  return `${timestamp(millis)} ${level.padEnd(5)} ${pick(LOGGERS)} - ${message}\n`;
}

function stackTrace(): string {
  const depth = int(4, 12);
  let trace = '';
  for (let i = 0; i < depth; i += 1) {
    trace += `\tat ${fill(pick(FRAMES))}\n`;
  }
  if (random() < 0.4) {
    trace += `Caused by: ${fill(pick(EXCEPTIONS))}\n`;
    for (let i = 0; i < int(2, 5); i += 1) {
      trace += `\tat ${fill(pick(FRAMES))}\n`;
    }
    trace += `\t... ${int(3, 40)} common frames omitted\n`;
  }
  return trace;
}

function hugeLine(millis: number): string {
  const target = HUGE_LINE_MIN + Math.floor(random() * HUGE_LINE_MIN);
  const chunk =
    '{"_id":"abc-123","_path":"/content/año/über","displayName":"Ünicode 日本語 🚀","data":{"text":"lorem ipsum dolor sit amet"}},';
  let payload = '';
  while (payload.length < target) payload += chunk;
  return entry(millis, 'DEBUG', `Node dump payload: [${payload}]`);
}

// Returns the emitted text plus how many lines it holds.
function nextEvent(millis: number): [string, number] {
  const level = pick(LEVELS);
  if (level === 'ERROR') {
    const text = entry(millis, level, fill(pick(ERRORS)));
    const exception = `${fill(pick(EXCEPTIONS))}\n`;
    const trace = stackTrace();
    const block = text + exception + trace;
    return [block, block.split('\n').length - 1];
  }
  if (level === 'WARN') return [entry(millis, level, fill(pick(WARNINGS))), 1];
  return [entry(millis, level, fill(pick(MESSAGES))), 1];
}

//
// * Writing
//

function writeLog(
  name: string,
  lines: number,
  startMillis: number,
  trailingNewline: boolean,
): void {
  const file = path.join(FIXTURES_DIR, name);
  const fd = openSync(file, 'w');
  try {
    let buffer = '';
    let written = 0;
    let nextHuge = HUGE_LINE_EVERY;
    let millis = startMillis;
    while (written < lines) {
      const huge = written >= nextHuge;
      if (huge) nextHuge += HUGE_LINE_EVERY;
      const [text, count] = huge ? [hugeLine(millis), 1] : nextEvent(millis);
      buffer += text;
      written += count;
      millis += int(1, 400);
      if (buffer.length >= FLUSH_BYTES) {
        writeSync(fd, buffer);
        buffer = '';
      }
    }
    if (!trailingNewline && buffer.endsWith('\n')) buffer = buffer.slice(0, -1);
    writeSync(fd, buffer);
  } finally {
    closeSync(fd);
  }
  const { size } = statSync(file);
  console.log(`${name}: ~${lines} lines, ${(size / 1024 / 1024).toFixed(1)} MiB`);
}

function generate(): void {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  random = mulberry32(SEED);
  writeLog('server.2026-08-24.0.log', ROTATED_LINES, Date.UTC(2026, 7, 24, 6, 12, 3, 117), true);
  writeLog('server.2026-08-26.0.log', TAIL_LINES, Date.UTC(2026, 7, 26, 22, 41, 9, 4), false);
  writeLog(ACTIVE_LOG, ACTIVE_LINES, Date.UTC(2026, 7, 27, 8, 0, 0, 0), true);
}

function append(): void {
  const file = path.join(FIXTURES_DIR, ACTIVE_LOG);
  statSync(file);
  console.log(`Appending to ${file} every ${APPEND_INTERVAL_MS} ms — Ctrl-C to stop`);
  setInterval(() => {
    const [text] = nextEvent(Date.now());
    appendFileSync(file, text);
    process.stdout.write('.');
  }, APPEND_INTERVAL_MS);
}

if (process.argv.includes('--append')) {
  append();
} else {
  generate();
}
