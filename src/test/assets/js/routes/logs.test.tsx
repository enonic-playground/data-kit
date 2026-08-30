// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserEvent } from '@testing-library/user-event';

import { fireEvent, renderRoute, screen, waitFor, within } from '../test-utils';

vi.mock('../../../../main/resources/assets/js/lib/api/client', () => ({
  apiFetch: vi.fn(),
  buildUrl: (apiUrl: string, params?: Record<string, string>) =>
    `${apiUrl}?${new URLSearchParams(params).toString()}`,
}));

vi.mock('../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => ({
    appId: 'com.enonic.app.datakit',
    assetsUri: '/assets',
    toolUri: '/',
    apiUris: {
      system: '/api/system',
      repositories: '/api/repositories',
      branches: '/api/branches',
      nodes: '/api/nodes',
      search: '/api/search',
      binary: '/api/binary',
      snapshots: '/api/snapshots',
      dumps: '/api/dumps',
      tasks: '/api/tasks',
      logs: '/api/logs',
    },
    launcherUri: '/launcher',
    user: { key: 'user:system:su', displayName: 'Super User' },
  })),
}));

// ? jsdom gives every element a zero-sized rect, so the real virtualizer would
// ? render nothing. A fixed window of rows keeps the page assertions honest.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 50) }, (_, index) => ({
        key: index,
        index,
        start: index * 18,
        end: (index + 1) * 18,
        size: 18,
        lane: 0,
      })),
    getTotalSize: () => count * 18,
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {},
  }),
}));

import { apiFetch } from '../../../../main/resources/assets/js/lib/api/client';

const LOG_LINES = [
  '10:23:45.123 INFO  com.enonic.xp.web.WebDispatcherServlet - Started dispatcher',
  '10:23:46.001 ERROR com.enonic.xp.script.ScriptExecutor - Failed to run script',
  '\tat com.enonic.xp.script.impl.ScriptRunner.run(ScriptRunner.java:42)',
];

const ROTATED_FILE = 'server.2026-08-26.0.log';

// ? Where the fixture's window lands: on the ERROR entry, so a cut drops the INFO line above it
// ? and keeps the entry with its stack frame.
const CUT_LINE = 1;
const CUT_TIME = '10:23:46.001';

/** What each span resolves to against the fixture. Only 15 minutes reaches past the first line. */
function windowFor(minutes: number): { line: number; time: string | null } {
  if (minutes <= 15) return { line: CUT_LINE, time: CUT_TIME };
  return { line: 0, time: null };
}

const LOG_FILES = [
  {
    name: 'server.log',
    size: 2048,
    modified: '2026-08-27T10:23:46Z',
    active: true,
    rotated: false,
  },
  {
    name: ROTATED_FILE,
    size: 512,
    modified: '2026-08-26T23:59:00Z',
    active: false,
    rotated: true,
  },
];

type Params = Record<string, string>;

// ? Effective level per line: the frame at index 2 belongs to the ERROR entry above it, which
// ? is the whole reason filtering happens on the server.
const LINE_LEVELS = ['INFO', 'ERROR', 'ERROR'] as const;

const LEVEL_COUNTS = { unknown: 0, trace: 0, debug: 0, info: 1, warn: 0, error: 2 };

/** The levels a request filters by, or `null` when it asks for every line. */
function requestedLevels(params: Params): string[] | null {
  const raw = params.levels;
  if (raw == null || raw === '') return null;
  const names = raw.split(',');
  return names.length === LINE_LEVELS.length + 2 ? null : names;
}

/** First physical line the time window admits. */
function windowStart(params: Params): number {
  const raw = Number.parseInt(params.start ?? '0', 10);
  return Number.isFinite(raw) ? raw : 0;
}

/** Whether either of the two things that narrow a view is in effect. */
function narrowed(params: Params): boolean {
  return requestedLevels(params) != null || windowStart(params) > 0;
}

/** Physical line numbers the request admits, in order. */
function visibleLines(params: Params): number[] {
  const names = requestedLevels(params);
  const admitted =
    names == null
      ? LOG_LINES.map((_, index) => index)
      : LINE_LEVELS.flatMap((level, index) => (names.includes(level) ? [index] : []));
  return admitted.filter((index) => index >= windowStart(params));
}

// ! Level codes, not positions in LINE_LEVELS — the wire format indexes `levels` by the code in
// ! `LogManager.kt`, where 0 is a continuation belonging to the entry above it.
const LEVEL_CODES: Record<string, number> = { TRACE: 1, DEBUG: 2, INFO: 3, WARN: 4, ERROR: 5 };

/** Every match in the file, filter or no filter — the count is built without a level mask. */
function allMatches(query: string): number[] {
  if (query === '') return [];
  return LOG_LINES.flatMap((line, index) => (line.includes(query) ? [index] : []));
}

/** The whole-file count fields both scanning actions carry. The fixture is small enough to
 *  finish in one slice, so `complete` is always true. */
function matchProgress(query: string, start = 0): Record<string, unknown> {
  const matches = allMatches(query).filter((index) => index >= start);
  const levels = [0, 0, 0, 0, 0, 0];
  for (const index of matches) levels[LEVEL_CODES[LINE_LEVELS[index]]] += 1;
  return {
    total: matches.length,
    levels,
    scanned: LOG_LINES.length,
    lines: LOG_LINES.length,
    complete: true,
  };
}

function respond(params: Params): unknown {
  if (params.action === 'info') {
    const info: Record<string, unknown> = {
      name: params.file,
      size: 2048,
      modified: '2026-08-27T10:23:46Z',
      lines: LOG_LINES.length,
      levels: LEVEL_COUNTS,
    };
    if (narrowed(params)) info.filtered = visibleLines(params).length;
    return info;
  }
  if (params.action === 'locate') {
    const line = Number.parseInt(params.line ?? '0', 10);
    const visible = visibleLines(params);
    const exact = visible.indexOf(line);
    if (exact >= 0) return { position: exact, visible: true };
    return {
      position: Math.max(0, visible.filter((entry) => entry < line).length - 1),
      visible: false,
    };
  }
  if (params.action === 'window') {
    // ? Each preset cuts to a different line, so a test can tell which one was actually asked
    // ? for — a mock answering every span alike would pass a hardcoded or mis-mapped preset.
    return windowFor(Number.parseInt(params.minutes ?? '0', 10));
  }
  if (params.action === 'matches') {
    return matchProgress(params.query ?? '', windowStart(params));
  }
  if (params.action === 'search') {
    const from = Number.parseInt(params.from ?? '0', 10);
    const query = params.query ?? '';
    // ? Scoped to the filter, like the server: a hit it hides is not a place the reader can go.
    const visible = visibleLines(params);
    const hits = visible.filter((index) => LOG_LINES[index].includes(query));
    const found =
      params.direction === 'backward'
        ? hits.findLast((index) => index <= from)
        : hits.find((index) => index >= from);
    // ? Matches the filter admits that sit above the hit — the same walk the server does.
    const ordinal =
      found == null
        ? null
        : allMatches(query).filter((index) => index < found && visible.includes(index)).length;
    return { ...matchProgress(query, windowStart(params)), line: found ?? null, ordinal };
  }
  if (params.file != null) {
    const visible = visibleLines(params);
    const lines = visible.map((index) => LOG_LINES[index]);
    if (!narrowed(params)) {
      return { from: 0, lines, total: lines.length, size: 2048 };
    }
    return { from: 0, lines, numbers: visible, total: visible.length, size: 2048 };
  }
  return { files: LOG_FILES };
}

function mockApi(files = LOG_FILES): void {
  const handler = (_apiUrl: string, options?: { params?: Params }): Promise<unknown> => {
    const params = options?.params ?? {};
    if (files.length === 0 && params.file == null) return Promise.resolve({ files: [] });
    return Promise.resolve(respond(params));
  };
  vi.mocked(apiFetch).mockImplementation(handler as unknown as typeof apiFetch);
}

/** Info responses land late, so the view is momentarily empty between two filter toggles. */
function mockApiWithSlowInfo(delayMs: number): void {
  const handler = (_apiUrl: string, options?: { params?: Params }): Promise<unknown> => {
    const params = options?.params ?? {};
    const value = respond(params);
    if (params.action !== 'info') return Promise.resolve(value);
    return new Promise((resolve) => setTimeout(() => resolve(value), delayMs));
  };
  vi.mocked(apiFetch).mockImplementation(handler as unknown as typeof apiFetch);
}

/** Line reads never resolve, so no row ever learns its physical line number. */
function mockApiWithPendingReads(): void {
  const handler = (_apiUrl: string, options?: { params?: Params }): Promise<unknown> => {
    const params = options?.params ?? {};
    if (params.file != null && params.action == null) return new Promise(() => {});
    return Promise.resolve(respond(params));
  };
  vi.mocked(apiFetch).mockImplementation(handler as unknown as typeof apiFetch);
}

/** A file of one line, so the row's own character caps decide what reaches the DOM. */
function mockApiWithLine(line: string): void {
  const handler = (_apiUrl: string, options?: { params?: Params }): Promise<unknown> => {
    const params = options?.params ?? {};
    if (params.action === 'info') {
      return Promise.resolve({
        name: params.file,
        size: line.length,
        modified: '2026-08-27T10:23:46Z',
        lines: 1,
        levels: { unknown: 1, trace: 0, debug: 0, info: 0, warn: 0, error: 0 },
      });
    }
    if (params.file != null && params.action == null) {
      return Promise.resolve({ from: 0, lines: [line], total: 1, size: line.length });
    }
    return Promise.resolve(respond(params));
  };
  vi.mocked(apiFetch).mockImplementation(handler as unknown as typeof apiFetch);
}

/** Holds the search response open, so a filter change can land while one is still in flight. */
function mockApiWithHeldSearch(): () => void {
  let release = (): void => {};
  const handler = (_apiUrl: string, options?: { params?: Params }): Promise<unknown> => {
    const params = options?.params ?? {};
    const value = respond(params);
    if (params.action !== 'search') return Promise.resolve(value);
    return new Promise((resolve) => {
      release = () => resolve(value);
    });
  };
  vi.mocked(apiFetch).mockImplementation(handler as unknown as typeof apiFetch);
  return () => release();
}

/** Locate responses hang, so a second click lands while the first one is still unresolved. */
function mockApiWithSlowLocate(delayMs: number): void {
  const handler = (_apiUrl: string, options?: { params?: Params }): Promise<unknown> => {
    const params = options?.params ?? {};
    const value = respond(params);
    if (params.action !== 'locate') return Promise.resolve(value);
    return new Promise((resolve) => setTimeout(() => resolve(value), delayMs));
  };
  vi.mocked(apiFetch).mockImplementation(handler as unknown as typeof apiFetch);
}

function locateCalls(): Params[] {
  return vi
    .mocked(apiFetch)
    .mock.calls.map((call) => (call[1] as { params?: Params })?.params ?? {})
    .filter((params) => params.action === 'locate');
}

function levelParams(): (string | undefined)[] {
  return vi
    .mocked(apiFetch)
    .mock.calls.map((call) => (call[1] as { params?: Params })?.params?.levels);
}

function searchCalls(): Params[] {
  return vi
    .mocked(apiFetch)
    .mock.calls.map((call) => (call[1] as { params?: Params })?.params ?? {})
    .filter((params) => params.action === 'search');
}

function matchCalls(): Params[] {
  return vi
    .mocked(apiFetch)
    .mock.calls.map((call) => (call[1] as { params?: Params })?.params ?? {})
    .filter((params) => params.action === 'matches');
}

/** Opens the time-window menu and picks one of its items. */
async function cutTo(user: UserEvent, item: string): Promise<void> {
  await user.click(within(getLogsPage()).getByRole('button', { name: 'Time window' }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

/** Params of every window request made so far, oldest first. */
function windowCalls(): Params[] {
  return vi
    .mocked(apiFetch)
    .mock.calls.map(([, options]) => (options as { params?: Params } | undefined)?.params ?? {})
    .filter((params) => params.action === 'window');
}

function getLogsPage(): HTMLElement {
  const element = document.querySelector('[data-component="LogsPage"]');
  if (!element) throw new Error('LogsPage not found');
  return element as HTMLElement;
}

// ? jsdom reports every scroll metric as 0, which reads as "pinned to the bottom" whatever the
// ? viewport does; stubs make the directions distinguishable. They go on the prototype rather
// ? than on the element, because the viewer aims its jump to the end at the geometry it can read
// ? in the frame it mounts — a stub installed once the page is on screen arrives after that.
const VIEWPORT_DEFAULTS = { scrollHeight: 1000, clientHeight: 100 };
const VIEWPORT: { scrollHeight: number; clientHeight: number } = { ...VIEWPORT_DEFAULTS };

// ? A test that needs a metric to move under the viewer redefines it as a getter, so the reset
// ? has to put a plain value back rather than assign through one.
const VIEWPORT_METRIC = { writable: true, configurable: true, enumerable: true };

const isViewer = (element: Element): boolean =>
  element.getAttribute('data-component') === 'LogViewer';

for (const metric of ['scrollHeight', 'clientHeight'] as const) {
  Object.defineProperty(Element.prototype, metric, {
    configurable: true,
    get(this: Element) {
      return isViewer(this) ? VIEWPORT[metric] : 0;
    },
  });
}

/** Tell the viewer its layout moved — jsdom lays nothing out, so nothing else ever will. */
function fireResize(): void {
  const observer = {} as ResizeObserver;
  for (const callback of window.__resizeObserverCallbacks ?? []) callback([], observer);
}

function getViewer(): HTMLElement {
  const viewer = document.querySelector('[data-component="LogViewer"]');
  if (!viewer) throw new Error('LogViewer not found');
  return viewer as HTMLElement;
}

async function scrollViewerTo(scrollTop: number): Promise<void> {
  const viewer = getViewer();

  viewer.scrollTop = scrollTop;

  // ? The jump to the end suppresses scroll reporting for a frame or two, so a
  // ? single event can land inside that window and be dropped.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    fireEvent.scroll(viewer);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('LogsPage', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    mockApi();
    Object.defineProperties(VIEWPORT, {
      scrollHeight: { ...VIEWPORT_METRIC, value: VIEWPORT_DEFAULTS.scrollHeight },
      clientHeight: { ...VIEWPORT_METRIC, value: VIEWPORT_DEFAULTS.clientHeight },
    });
  });

  it('should render the toolbar and the file select', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      getLogsPage();
    });

    const page = within(getLogsPage());
    expect(page.getByLabelText('Select log file')).toBeInTheDocument();
    expect(page.getByRole('button', { name: 'Follow' })).toBeInTheDocument();
    expect(page.getByRole('button', { name: 'Wrap' })).toBeInTheDocument();
    expect(page.getByLabelText('Search in log file')).toBeInTheDocument();
    expect(page.getByLabelText('Go to line')).toBeInTheDocument();
    expect(page.getByLabelText('Next match')).toBeInTheDocument();
    expect(page.getByLabelText('Scroll to end')).toBeInTheDocument();
  });

  it('should render log lines from the API', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    expect(screen.getByText(/Failed to run script/)).toBeInTheDocument();
    expect(screen.getByText(/ScriptRunner\.java:42/)).toBeInTheDocument();
  });

  it('should number lines through the gutter attribute', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const rows = getLogsPage().querySelectorAll('[data-component="LogRow"]');
    expect(rows).toHaveLength(LOG_LINES.length);
    expect(rows[0].getAttribute('data-line')).toBe('1');
    expect(rows[2].getAttribute('data-line')).toBe('3');
    // ? Numbers live in a pseudo-element, so they never end up in copied text.
    expect(rows[0].textContent).toBe(LOG_LINES[0]);
  });

  it('should colour the level token apart from the rest of the line', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Failed to run script/)).toBeInTheDocument();
    });

    const rows = getLogsPage().querySelectorAll('[data-component="LogRow"]');
    const spans = rows[1].querySelectorAll('span');

    expect(spans[0].textContent).toBe('10:23:46.001');
    expect(spans[0].className).toContain('text-text-dimmed');
    expect(spans[1].textContent).toBe(' ERROR');
    expect(spans[1].className).toContain('text-log-error');
    expect(spans[2].textContent).toBe(' com.enonic.xp.script.ScriptExecutor - ');
    expect(spans[2].className).toContain('text-muted-foreground');
    // ? Segments are slices, so the row still copies as the original line.
    expect(rows[1].textContent).toBe(LOG_LINES[1]);
  });

  it('should show the status footer and a download link', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    expect(page.getByText('Size 2.0 KB')).toBeInTheDocument();
    expect(page.getByLabelText('Download log file')).toHaveAttribute(
      'href',
      expect.stringContaining('action=download'),
    );
  });

  it('should highlight search matches inside the rendered lines', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    await user.type(within(getLogsPage()).getByLabelText('Search in log file'), 'dispatcher');

    await waitFor(() => {
      expect(getLogsPage().querySelectorAll('mark').length).toBeGreaterThan(0);
    });
  });

  it('should ask the server for the next match', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'ERROR');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      const searched = vi
        .mocked(apiFetch)
        .mock.calls.some((call) => (call[1] as { params?: Params })?.params?.action === 'search');
      expect(searched).toBe(true);
    });
  });

  it('should include the first visible line in a fresh forward search', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'Started dispatcher');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });

    expect(searchCalls()[0].from).toBe('0');
    expect(page.queryByText('No match')).not.toBeInTheDocument();
  });

  it('should hold the last match instead of reporting no match', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'ScriptRunner');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(page.getByText('1 of 1')).toBeInTheDocument();
    });

    await user.click(page.getByLabelText('Next match'));

    expect(page.getByText('1 of 1')).toBeInTheDocument();
    expect(page.queryByText('No match')).not.toBeInTheDocument();
    // ? The cursor sits on the last line, so there is nothing left to ask for.
    expect(searchCalls().map((params) => params.from)).toEqual(['0']);
  });

  it('should hold the first match when stepping backward past it', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'Started dispatcher');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(page.getByText('1 of 1')).toBeInTheDocument();
    });

    await user.click(page.getByLabelText('Previous match'));

    expect(page.getByText('1 of 1')).toBeInTheDocument();
    expect(page.queryByText('No match')).not.toBeInTheDocument();
    // ? Stepping off line 0 lands above the file, so no request is worth sending.
    expect(searchCalls()).toHaveLength(1);
  });

  it('should include the first line after scrolling to the start', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.click(page.getByLabelText('Scroll to start'));
    await user.type(page.getByLabelText('Search in log file'), 'Started dispatcher');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });

    expect(searchCalls()[0].from).toBe('0');
    expect(page.queryByText('No match')).not.toBeInTheDocument();
  });

  it('should include the last line after scrolling to the end', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.click(page.getByLabelText('Scroll to end'));
    await user.type(page.getByLabelText('Search in log file'), 'ScriptRunner');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });

    expect(page.queryByText('No match')).not.toBeInTheDocument();

    await user.click(page.getByLabelText('Next match'));

    // ? Stepping past the last match holds on it rather than emptying the badge.
    expect(page.getByText('1 of 1')).toBeInTheDocument();
    expect(searchCalls()).toHaveLength(1);
  });

  it('should drop the previous cursor when the query changes', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    const search = page.getByLabelText('Search in log file');
    await user.type(search, 'ScriptRunner');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });

    await user.clear(search);
    await user.type(search, 'Started dispatcher');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(2);
    });

    expect(searchCalls().map((params) => params.from)).toEqual(['0', '0']);
    expect(page.queryByText('No match')).not.toBeInTheDocument();
  });

  it('should drop the no-match verdict when the regex toggle changes the criteria', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'zzz');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(page.getByText('No match')).toBeInTheDocument();
    });

    await user.click(page.getByLabelText('Regular expression'));

    await waitFor(() => {
      expect(page.queryByText('No match')).not.toBeInTheDocument();
    });
  });

  it('should drop the search error when the case toggle changes the criteria', async () => {
    const failing = (_apiUrl: string, options?: { params?: Params }): Promise<unknown> => {
      const params = options?.params ?? {};
      if (params.action === 'search') {
        return Promise.reject({ status: 400, message: 'Invalid regular expression' });
      }
      return Promise.resolve(respond(params));
    };
    vi.mocked(apiFetch).mockImplementation(failing as unknown as typeof apiFetch);

    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'ERROR');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(page.getByText('Invalid regular expression')).toBeInTheDocument();
    });

    await user.click(page.getByLabelText('Match case'));

    await waitFor(() => {
      expect(page.queryByText('Invalid regular expression')).not.toBeInTheDocument();
    });
  });

  it('should keep the goto cursor when the query changes', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    const search = page.getByLabelText('Search in log file');
    // ? Every line matches, so `from` alone decides which one comes back.
    await user.type(search, 'com');
    await user.type(page.getByLabelText('Go to line'), '2');
    await user.click(page.getByRole('button', { name: 'Go' }));
    await user.type(search, '.enonic.xp');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });

    // ? The goto is criteria-agnostic, so editing the query must not send the
    // ? next search back to the viewport.
    expect(searchCalls()[0]).toMatchObject({ from: '1', query: 'com.enonic.xp' });
  });

  it('should resume a forward search at the line the goto jumped to', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    // ? Every line matches, so `from` alone decides which one comes back.
    await user.type(page.getByLabelText('Search in log file'), 'com.enonic.xp');
    await user.type(page.getByLabelText('Go to line'), '2');
    await user.click(page.getByRole('button', { name: 'Go' }));
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });

    expect(searchCalls()[0]).toMatchObject({ from: '1', direction: 'forward' });
  });

  it('should resume a backward search at the line the goto jumped to', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'com.enonic.xp');
    await user.type(page.getByLabelText('Go to line'), '2');
    await user.click(page.getByRole('button', { name: 'Go' }));
    await user.click(page.getByLabelText('Previous match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });

    expect(searchCalls()[0]).toMatchObject({ from: '1', direction: 'backward' });
  });

  it('should discard a search still in flight when the query changes', async () => {
    const pending: ((value: unknown) => void)[] = [];
    const deferred = (_apiUrl: string, options?: { params?: Params }): Promise<unknown> => {
      const params = options?.params ?? {};
      if (params.action === 'search' && params.query === 'com') {
        return new Promise((resolve) => {
          pending.push(resolve);
        });
      }
      return Promise.resolve(respond(params));
    };
    vi.mocked(apiFetch).mockImplementation(deferred as unknown as typeof apiFetch);

    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    const search = page.getByLabelText('Search in log file');
    await user.type(search, 'com');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });

    await user.clear(search);
    await user.type(search, 'ERROR');

    pending[0]({ line: 1 });

    await waitFor(() => {
      expect(page.getByLabelText('Next match')).toBeEnabled();
    });

    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(2);
    });

    // ? The stale result must leave no cursor behind, so the viewport anchors.
    expect(searchCalls()[1].from).toBe('0');
  });

  it('should follow the newest output by default', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    expect(page.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('should land on the last line, not on the offset the estimates predicted', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(getViewer().scrollTop).toBe(VIEWPORT.scrollHeight - VIEWPORT.clientHeight);
    });
  });

  it('should re-aim at the end when a scrollbar shortens the viewport after the jump', async () => {
    const SCROLLBAR_PX = 15;

    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(getViewer().scrollTop).toBe(VIEWPORT.scrollHeight - VIEWPORT.clientHeight);
    });

    // ? What the widest measured row brings with it once the text lands, a fetch after the jump
    // ? has already been aimed and fired. The bottom moves down by exactly the scrollbar's
    // ? height, and the last line ends up cropped underneath it.
    VIEWPORT.clientHeight -= SCROLLBAR_PX;
    fireResize();

    await waitFor(() => {
      expect(getViewer().scrollTop).toBe(VIEWPORT.scrollHeight - VIEWPORT.clientHeight);
    });
  });

  it('should re-aim at the end when wrapped rows measure taller than their estimate', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    // ? Wrapping turns each estimated 18px row into several, so the content outgrows the height
    // ? the jump was computed against and the end of the file drops below the viewport.
    VIEWPORT.scrollHeight *= 3;
    fireResize();

    await waitFor(() => {
      expect(getViewer().scrollTop).toBe(VIEWPORT.scrollHeight - VIEWPORT.clientHeight);
    });
  });

  it('should stop re-aiming once the reader takes over', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    fireEvent.wheel(getViewer());
    await scrollViewerTo(120);

    // ? The layout settling after the reader has moved must not haul them back to the end.
    VIEWPORT.scrollHeight *= 3;
    fireResize();

    expect(getViewer().scrollTop).toBe(120);
    expect(within(getLogsPage()).getByRole('button', { name: 'Follow' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('should disarm follow when the user scrolls away from the end', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    const followButton = page.getByRole('button', { name: 'Follow' });

    await scrollViewerTo(400);

    await waitFor(() => {
      expect(followButton).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('should re-arm follow when the user scrolls back to the end', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    const followButton = page.getByRole('button', { name: 'Follow' });

    await scrollViewerTo(400);
    await waitFor(() => {
      expect(followButton).toHaveAttribute('aria-pressed', 'false');
    });

    await scrollViewerTo(VIEWPORT.scrollHeight - VIEWPORT.clientHeight);

    await waitFor(() => {
      expect(followButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('should not offer to follow a rotated file', async () => {
    renderRoute({ initialLocation: `/logs?file=${ROTATED_FILE}` });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    const followButton = page.getByRole('button', { name: 'Follow' });

    expect(followButton).toBeDisabled();
    expect(followButton).toHaveAttribute('aria-pressed', 'false');
    expect(page.getByText('rotated')).toBeInTheDocument();
    expect(page.queryByText('following')).not.toBeInTheDocument();
  });

  it('should keep following available on the active file', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    const followButton = page.getByRole('button', { name: 'Follow' });

    expect(followButton).toBeEnabled();
    expect(followButton).toHaveAttribute('aria-pressed', 'true');
    expect(page.getByText('following')).toBeInTheDocument();
    expect(page.queryByText('rotated')).not.toBeInTheDocument();
  });

  it('should re-arm follow when scrolling to the end from the toolbar', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    const followButton = page.getByRole('button', { name: 'Follow' });

    await user.click(followButton);
    expect(followButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(page.getByLabelText('Scroll to end'));

    await waitFor(() => {
      expect(followButton).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('should ignore a go-to-line value that is not a line number', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Go to line'), '12abc');

    expect(page.getByLabelText('Go to line')).toHaveValue('12');
  });

  it('should clear the no-match verdict when jumping to the start', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'nothing-matches-this');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(page.getByText('No match')).toBeInTheDocument();
    });

    await user.click(page.getByLabelText('Scroll to start'));

    await waitFor(() => {
      expect(page.queryByText('No match')).not.toBeInTheDocument();
    });
  });

  it('should report which match of how many the reader is on', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'com.enonic.xp');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(page.getByText('1 of 3')).toBeInTheDocument();
    });

    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(page.getByText('2 of 3')).toBeInTheDocument();
    });
  });

  it('should count the matches the filter is holding back', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await hideLevels(user, 'INFO');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'com.enonic.xp');
    await user.click(page.getByLabelText('Next match'));

    // ? Three matches in the file, one of them on the INFO line the filter now hides.
    await waitFor(() => {
      expect(page.getByText('1 of 2 (+1 hidden by filter)')).toBeInTheDocument();
    });
  });

  it('should surface the server message when the search request fails', async () => {
    const failing = (_apiUrl: string, options?: { params?: Params }): Promise<unknown> => {
      const params = options?.params ?? {};
      if (params.action === 'search') {
        return Promise.reject({
          status: 400,
          message: 'Invalid regular expression: Unterminated character class',
        });
      }
      return Promise.resolve(respond(params));
    };
    vi.mocked(apiFetch).mockImplementation(failing as unknown as typeof apiFetch);

    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'ERROR');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(
        page.getByText('Invalid regular expression: Unterminated character class'),
      ).toBeInTheDocument();
    });

    expect(page.queryByText('No match')).not.toBeInTheDocument();
  });

  //
  // * Level filter
  //

  async function hideLevels(user: UserEvent, ...names: string[]): Promise<void> {
    await user.click(within(getLogsPage()).getByRole('button', { name: 'Log levels' }));
    for (const name of names) {
      await user.click(
        await screen.findByRole('menuitemcheckbox', { name: new RegExp(`^${name}`) }),
      );
    }
    await user.keyboard('{Escape}');
  }

  it('should list every level with its line count', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await user.click(within(getLogsPage()).getByRole('button', { name: 'Log levels' }));

    expect(await screen.findByRole('menuitemcheckbox', { name: /^INFO/ })).toHaveTextContent('1');
    expect(screen.getByRole('menuitemcheckbox', { name: /^ERROR/ })).toHaveTextContent('2');
    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(5);
  });

  it('should show only the selected levels, keeping physical line numbers', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await hideLevels(user, 'INFO');

    await waitFor(() => {
      expect(screen.queryByText(/Started dispatcher/)).not.toBeInTheDocument();
    });

    const rows = getLogsPage().querySelectorAll('[data-component="LogRow"]');
    expect(rows).toHaveLength(2);
    // ? The gutter keeps the number the line has in the file, not its row in the view.
    expect(rows[0].getAttribute('data-line')).toBe('2');
    expect(rows[1].getAttribute('data-line')).toBe('3');
    expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
  });

  it('should send the selected levels in the canonical order', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    // ? Unchecked in an order that is not the wire order; the request must not follow it.
    await hideLevels(user, 'INFO', 'DEBUG', 'TRACE');

    await waitFor(() => {
      expect(levelParams()).toContain('WARN,ERROR');
    });
    expect(levelParams()).not.toContain('ERROR,WARN');
  });

  it('should send no level parameter while every level is selected', async () => {
    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    expect(levelParams().every((value) => value === undefined)).toBe(true);
  });

  it('should restore the whole file from the clear action', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await hideLevels(user, 'INFO');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    await user.click(within(getLogsPage()).getByRole('button', { name: 'Log levels' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Show all levels' }));

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });
    expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
  });

  it('should scroll to a match the filter still shows', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await hideLevels(user, 'INFO');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'Failed to run script');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(page.getByText('1 of 1')).toBeInTheDocument();
    });
  });

  it('should report no match when the filter hides every hit', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await hideLevels(user, 'INFO');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'Started dispatcher');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(page.getByText('No match')).toBeInTheDocument();
    });
  });

  it('should send the active levels with the search', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await hideLevels(user, 'INFO');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'ScriptRunner');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });
    expect(searchCalls()[0].levels).toBe('TRACE,DEBUG,WARN,ERROR');
  });

  it('should report a go-to-line the filter is hiding', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await hideLevels(user, 'INFO');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Go to line'), '1');
    await user.click(page.getByRole('button', { name: 'Go' }));

    await waitFor(() => {
      expect(page.getByText('Line 1 is not in the current view')).toBeInTheDocument();
    });
  });

  it('should land a filtered match on a line the filter still shows', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await hideLevels(user, 'ERROR');
    await waitFor(() => {
      expect(screen.getByText('1 of 3 lines')).toBeInTheDocument();
    });
    await scrollViewerTo(0);

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'ScriptRunner');
    await user.click(page.getByLabelText('Next match'));

    // ? The only hit is the frame of the ERROR entry the filter removed.
    await waitFor(() => {
      expect(page.getByText('No match')).toBeInTheDocument();
    });
  });

  it('should drop the hidden verdict once the filter that hid the line is gone', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await hideLevels(user, 'INFO');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Go to line'), '1');
    await user.click(page.getByRole('button', { name: 'Go' }));

    await waitFor(() => {
      expect(page.getByText('Line 1 is not in the current view')).toBeInTheDocument();
    });

    await user.click(within(getLogsPage()).getByRole('button', { name: 'Log levels' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Show all levels' }));

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });
    expect(page.queryByText('Line 1 is not in the current view')).not.toBeInTheDocument();
  });

  it('should keep the reading position across a burst of level toggles', async () => {
    mockApiWithSlowInfo(150);
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });
    await scrollViewerTo(0);

    // ? The menu stays open across toggles, and the second one lands while the first refetch is
    // ? still out — the moment the view has no rows to read a fresh anchor from.
    await user.click(within(getLogsPage()).getByRole('button', { name: 'Log levels' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /^TRACE/ }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /^DEBUG/ }));
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(locateCalls().length).toBeGreaterThan(0);
    });
    expect(locateCalls()[0].line).toBe('0');
  });

  it('should leave the gutter blank for a filtered row that has not arrived', async () => {
    mockApiWithPendingReads();
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const unfiltered = getLogsPage().querySelectorAll('[data-component="LogRow"]');
    expect(unfiltered[0].getAttribute('data-line')).toBe('1');

    await hideLevels(user, 'INFO');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    // ! Not '1' and '2'. Those are row positions, and a filter has decoupled them from the line
    // ! numbers — printing them would renumber the gutter the moment the chunk lands.
    const rows = getLogsPage().querySelectorAll('[data-component="LogRow"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-line')).toBe('');
    expect(rows[1].getAttribute('data-line')).toBe('');
  });

  it('should keep the reading position when a toggle lands between the count and the lines', async () => {
    // ? The other ordering: the count arrives fast and consumes the anchor, so the second
    // ? toggle reads a view that has rows but no line numbers yet.
    mockApiWithPendingReads();
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });
    await scrollViewerTo(0);

    await user.click(within(getLogsPage()).getByRole('button', { name: 'Log levels' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: /^TRACE/ }));
    await waitFor(() => {
      expect(locateCalls().length).toBe(1);
    });

    await user.click(await screen.findByRole('menuitemcheckbox', { name: /^DEBUG/ }));
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(locateCalls().length).toBe(2);
    });
    expect(locateCalls()[1]).toMatchObject({ line: '0', levels: 'INFO,WARN,ERROR' });
  });

  it('should step off a match whose row has not been resolved yet', async () => {
    mockApiWithSlowLocate(5000);
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await hideLevels(user, 'INFO');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });
    await scrollViewerTo(0);

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'ScriptRunner');
    await user.click(page.getByLabelText('Next match'));
    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });

    const located = locateCalls().length;

    // ? The locate for the hit is still out, so the cursor has no row to compare against the
    // ? viewport — it must still be the step-off point rather than the viewport.
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(locateCalls().length).toBe(located + 1);
    });
    // ? Stepping off line 2 lands past the end of a three-line file, so the hold is reached
    // ? without asking the server at all. Restarting from the viewport would have asked again
    // ? and been handed the same hit.
    expect(searchCalls()).toHaveLength(1);
    expect(page.queryByText('No match')).not.toBeInTheDocument();
  });

  it('should search from the reader position when the filtered rows have no numbers', async () => {
    mockApiWithPendingReads();
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    // ? Park the reader on line 2 through a match, then change the query so its cursor is
    // ? dropped — the viewport is now the only thing that can say where the reader is.
    const page = within(getLogsPage());
    const search = page.getByLabelText('Search in log file');
    await user.type(search, 'Failed to run script');
    await user.click(page.getByLabelText('Next match'));
    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });

    await hideLevels(user, 'INFO');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });
    await scrollViewerTo(0);

    await user.clear(search);
    await user.type(search, 'Started dispatcher');
    await user.click(page.getByLabelText('Previous match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(2);
    });
    // ! Line 1, where the reader is — not line 2, the end of the file. No row carries a number
    // ! here, so the origin is the last position the viewport actually resolved to.
    expect(searchCalls()[1].from).toBe('1');
  });

  it('should drop an ordinal decided under a filter the reader has changed', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'com.enonic.xp');
    await user.click(page.getByLabelText('Next match'));
    await waitFor(() => {
      expect(page.getByText('1 of 3')).toBeInTheDocument();
    });

    const before = matchCalls().length;
    await hideLevels(user, 'INFO');

    // ! The hit sat on the INFO line the filter now hides, and its ordinal counted matches in a
    // ! view that no longer exists. Keeping it would pair it with a split read off the new view.
    await waitFor(() => {
      expect(page.queryByText('1 of 3')).not.toBeInTheDocument();
    });
    expect(page.queryByText(/of 2/)).not.toBeInTheDocument();

    // ? The count itself is keyed without levels, so the toggle costs no rescan.
    expect(matchCalls()).toHaveLength(before);
  });

  it('should not count anything until a search is actually run', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'com.enonic.xp');

    // ! A count reads the whole file. Firing one per keystroke turns a 13-character query into
    // ! 13 whole-file scans, each holding a server slice the reader has already moved past.
    expect(matchCalls()).toHaveLength(0);

    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(matchCalls().length).toBeGreaterThan(0);
    });
    expect(matchCalls().every((params) => params.query === 'com.enonic.xp')).toBe(true);
  });

  it('should discard a search that was sent under a filter the reader has left', async () => {
    const release = mockApiWithHeldSearch();
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'ScriptRunner');
    await user.click(page.getByLabelText('Next match'));
    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });

    await hideLevels(user, 'ERROR');
    await waitFor(() => {
      expect(screen.getByText('1 of 3 lines')).toBeInTheDocument();
    });

    // ! The held hit was found with every level selected, and line 3 is an ERROR frame — the
    // ! filter now in effect has no row for it.
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(page.queryByText('Match at line 3')).not.toBeInTheDocument();
    expect(page.queryByText('No match')).not.toBeInTheDocument();
  });

  it('should truncate an oversized line in both wrap modes', async () => {
    // ? A continuation line, so the whole row is message and the caps apply to it undivided.
    const line = `\t${'x'.repeat(150_000)}`;
    mockApiWithLine(line);

    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(`… +${line.length - 10_000} chars`)).toBeInTheDocument();
    });

    await user.click(within(getLogsPage()).getByRole('button', { name: 'Wrap' }));

    // ! Wrap mode is capped too: unbounded, one line like this is hundreds of laid-out rows.
    await waitFor(() => {
      expect(screen.getByText(`… +${line.length - 100_000} chars`)).toBeInTheDocument();
    });
  });

  it('should report an oversized astral tail in UTF-16 units rather than walking it', async () => {
    // ? 100_000 emoji is 200_000 UTF-16 units. Counting them as code points means walking every
    // ? one on every keystroke, so past the scan bound the cheaper unit count is what shows.
    const line = `\t${'x'.repeat(10_000)}${'\u{1F600}'.repeat(100_000)}`;
    mockApiWithLine(line);

    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(`… +${line.length - 10_000} chars`)).toBeInTheDocument();
    });
  });

  it('should show an empty state when there are no log files', async () => {
    mockApi([]);

    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('No log files')).toBeInTheDocument();
    });
  });

  it('should cut the view to a time window and label the trigger with the cut', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });
    expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();

    await cutTo(user, 'Last 15 minutes');

    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Started dispatcher/)).not.toBeInTheDocument();
    expect(screen.getByText(/Failed to run script/)).toBeInTheDocument();
    expect(within(getLogsPage()).getByRole('button', { name: 'Time window' })).toHaveTextContent(
      'Since 10:23',
    );
  });

  it('should keep the gutter on physical line numbers under a window', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await cutTo(user, 'Last 15 minutes');

    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });
    const rows = getLogsPage().querySelectorAll('[data-component="LogRow"]');
    expect(rows[0]).toHaveAttribute('data-line', '2');
    expect(rows[1]).toHaveAttribute('data-line', '3');
  });

  it('should restore the whole file when the window is cleared', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await cutTo(user, 'Last 15 minutes');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    await cutTo(user, 'Full file');

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });
    expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    expect(within(getLogsPage()).getByRole('button', { name: 'Time window' })).toHaveTextContent(
      'Full file',
    );
  });

  it('should point the download at the window once one is cut', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    expect(page.getByRole('link', { name: 'Download log file' })).toHaveAttribute(
      'href',
      '/api/logs?file=server.log&action=download',
    );

    await cutTo(user, 'Last 15 minutes');

    await waitFor(() => {
      expect(page.getByRole('link', { name: 'Download from the cut' })).toHaveAttribute(
        'href',
        '/api/logs?file=server.log&action=download&start=1',
      );
    });
  });

  it('should send the span the reader picked, and cut nothing for one that covers the file', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await cutTo(user, 'Last 15 minutes');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });
    expect(windowCalls().map((params) => params.minutes)).toEqual(['15']);

    // ? A span wider than the file resolves to no cut, which is a real answer rather than a
    // ? failure — the reader is told, and the view goes back to the whole file.
    await cutTo(user, 'Last 6 hours');
    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });
    expect(windowCalls().map((params) => params.minutes)).toEqual(['15', '360']);
    expect(within(getLogsPage()).getByRole('button', { name: 'Time window' })).toHaveTextContent(
      'Full file',
    );
  });

  it('should say so when a go-to-line lands above the cut', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await cutTo(user, 'Last 15 minutes');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Go to line'), '1');
    await user.click(page.getByRole('button', { name: 'Go' }));

    // ! Line 1 is above the cut, so the jump cannot honour it. Retargeting to the first line of
    // ! the window without a word would report success for a line the view no longer holds.
    await waitFor(() => {
      expect(page.getByText('Line 1 is not in the current view')).toBeInTheDocument();
    });
  });

  it('should drop the window when the file rotates under it', async () => {
    let lines = [...LOG_LINES];
    vi.mocked(apiFetch).mockImplementation(((
      _apiUrl: string,
      options?: { params?: Params },
    ): Promise<unknown> => {
      const params = options?.params ?? {};
      if (params.file == null && params.action == null)
        return Promise.resolve({ files: LOG_FILES });
      if (params.action === 'window') {
        return Promise.resolve(windowFor(Number.parseInt(params.minutes ?? '0', 10)));
      }
      if (params.action === 'info') {
        return Promise.resolve({
          name: params.file,
          size: lines.length * 64,
          modified: '2026-08-27T10:23:46Z',
          lines: lines.length,
          levels: LEVEL_COUNTS,
          ...(windowStart(params) > 0
            ? { filtered: Math.max(0, lines.length - windowStart(params)) }
            : {}),
        });
      }
      const visible = lines.map((_, index) => index).filter((i) => i >= windowStart(params));
      return Promise.resolve({
        from: 0,
        lines: visible.map((index) => lines[index]),
        ...(windowStart(params) > 0 ? { numbers: visible } : {}),
        total: visible.length,
        size: lines.length * 64,
      });
    }) as unknown as typeof apiFetch);

    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await cutTo(user, 'Last 15 minutes');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    // ! Rotation replaces the contents under the same name, so nothing about the selection
    // ! changes — but the held line now points into a file that is gone. Left in place it
    // ! renders an empty view with no hint of why.
    lines = ['10:24:01.000 INFO  com.enonic.xp.Startup - Fresh file'];

    await waitFor(
      () => {
        expect(screen.getByText('1 lines')).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(within(getLogsPage()).getByRole('button', { name: 'Time window' })).toHaveTextContent(
      'Full file',
    );
    expect(screen.getByText(/Fresh file/)).toBeInTheDocument();
  });

  it('should drop the window when another file is opened', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    await cutTo(user, 'Last 15 minutes');
    await waitFor(() => {
      expect(screen.getByText('2 of 3 lines')).toBeInTheDocument();
    });

    await user.click(within(getLogsPage()).getByRole('combobox', { name: 'Select log file' }));
    await user.click(await screen.findByRole('option', { name: new RegExp(ROTATED_FILE) }));

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });
    expect(within(getLogsPage()).getByRole('button', { name: 'Time window' })).toHaveTextContent(
      'Full file',
    );
  });
});
