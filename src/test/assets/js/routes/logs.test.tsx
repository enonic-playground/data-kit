// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const LOG_FILES = [
  { name: 'server.log', size: 2048, modified: '2026-08-27T10:23:46Z', active: true },
  { name: 'server.2026-08-26.0.log', size: 512, modified: '2026-08-26T23:59:00Z', active: false },
];

type Params = Record<string, string>;

function respond(params: Params): unknown {
  if (params.action === 'info') {
    return {
      name: params.file,
      size: 2048,
      modified: '2026-08-27T10:23:46Z',
      lines: LOG_LINES.length,
    };
  }
  if (params.action === 'search') {
    const from = Number.parseInt(params.from ?? '0', 10);
    const query = params.query ?? '';
    const numbered = LOG_LINES.map((line, index) => ({ line, index }));
    const found =
      params.direction === 'backward'
        ? numbered
            .slice(0, from + 1)
            .reverse()
            .find((entry) => entry.line.includes(query))
        : numbered.slice(from).find((entry) => entry.line.includes(query));
    return { line: found?.index ?? null };
  }
  if (params.file != null) {
    return { from: 0, lines: LOG_LINES, total: LOG_LINES.length, size: 2048 };
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

function searchCalls(): Params[] {
  return vi
    .mocked(apiFetch)
    .mock.calls.map((call) => (call[1] as { params?: Params })?.params ?? {})
    .filter((params) => params.action === 'search');
}

function getLogsPage(): HTMLElement {
  const element = document.querySelector('[data-component="LogsPage"]');
  if (!element) throw new Error('LogsPage not found');
  return element as HTMLElement;
}

// ? jsdom reports every scroll metric as 0, which reads as "pinned to the
// ? bottom" whatever the viewport does; stubs make the directions distinguishable.
const VIEWPORT = { scrollHeight: 1000, clientHeight: 100 };

async function scrollViewerTo(scrollTop: number): Promise<void> {
  const viewer = document.querySelector('[data-component="LogViewer"]');
  if (!viewer) throw new Error('LogViewer not found');

  Object.defineProperty(viewer, 'scrollHeight', {
    value: VIEWPORT.scrollHeight,
    configurable: true,
  });
  Object.defineProperty(viewer, 'clientHeight', {
    value: VIEWPORT.clientHeight,
    configurable: true,
  });
  (viewer as HTMLElement).scrollTop = scrollTop;

  // ? The jump to the end suppresses scroll reporting for two frames, so a
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

  it('should report no match instead of re-reporting the last line', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText(/Started dispatcher/)).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'ScriptRunner');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(searchCalls()).toHaveLength(1);
    });

    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(page.getByText('No match')).toBeInTheDocument();
    });

    // ? The cursor sits on the last line, so there is nothing left to ask for.
    expect(searchCalls().map((params) => params.from)).toEqual(['0']);
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

    await waitFor(() => {
      expect(page.getByText('No match')).toBeInTheDocument();
    });
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

  it('should report the line a match was found on', async () => {
    const { user } = renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('3 lines')).toBeInTheDocument();
    });

    const page = within(getLogsPage());
    await user.type(page.getByLabelText('Search in log file'), 'ScriptExecutor');
    await user.click(page.getByLabelText('Next match'));

    await waitFor(() => {
      expect(page.getByText('Match at line 2')).toBeInTheDocument();
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

  it('should show an empty state when there are no log files', async () => {
    mockApi([]);

    renderRoute({ initialLocation: '/logs' });

    await waitFor(() => {
      expect(screen.getByText('No log files')).toBeInTheDocument();
    });
  });
});
