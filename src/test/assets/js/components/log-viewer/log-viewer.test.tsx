// @vitest-environment jsdom

import { act, render, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReactElement } from 'react';

vi.mock('../../../../../main/resources/assets/js/lib/config', () => ({
  getConfig: vi.fn(() => ({
    appId: 'com.enonic.app.datakit',
    assetsUri: '/assets',
    toolUri: '/',
    apiUris: { logs: '/api/logs' },
    launcherUri: '/launcher',
    user: { key: 'user:system:su', displayName: 'Super User' },
  })),
}));

vi.mock('../../../../../main/resources/assets/js/lib/api/client', () => ({
  apiFetch: vi.fn(),
  buildUrl: (apiUrl: string) => apiUrl,
}));

vi.mock('../../../../../main/resources/assets/js/components/ui/sonner', () => ({
  toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

// ? jsdom gives every element a zero-sized rect, so the real virtualizer renders nothing. This
// ? one renders a fixed window the test can slide, which is the whole point of the exercise.
const WINDOW_ROWS = 10;
let windowStart = 0;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.max(0, Math.min(WINDOW_ROWS, count - windowStart)) }, (_, at) => {
        const index = windowStart + at;
        return { key: index, index, start: index * 18, end: (index + 1) * 18, size: 18, lane: 0 };
      }),
    getTotalSize: () => count * 18,
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {},
  }),
}));

import { LogViewer } from '../../../../../main/resources/assets/js/components/log-viewer/log-viewer';
import { apiFetch } from '../../../../../main/resources/assets/js/lib/api/client';
import { LOG_LEVELS } from '../../../../../main/resources/assets/js/lib/api/logs';

const TOTAL = 200;

const lineText = (index: number): string =>
  `10:23:${String(index % 60).padStart(2, '0')}.000 INFO  com.enonic.Line - message ${index}`;

const fetchMock = vi.mocked(apiFetch);

const Viewer = ({ file }: { file: string }): ReactElement => (
  <LogViewer
    file={file}
    levels={LOG_LEVELS}
    total={TOTAL}
    size={4096}
    wrap={false}
    follow={false}
    onAtBottomChange={() => {}}
  />
);

let scrollTo: (start: number) => void = () => {};

const Harness = (): ReactElement => {
  const [, tick] = useState(0);
  useEffect(() => {
    scrollTo = (start: number) => {
      windowStart = start;
      tick((value) => value + 1);
    };
  }, []);

  return <Viewer file="server.log" />;
};

function rowElement(index: number): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-index="${index}"]`);
  if (row === null) throw new Error(`row ${index} is not mounted`);
  return row;
}

function textNodes(index: number): Text[] {
  const walker = document.createTreeWalker(rowElement(index), NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  if (nodes.length === 0) throw new Error(`row ${index} has no text`);
  return nodes;
}

const rowStart = (index: number): [Text, number] => [textNodes(index)[0], 0];

function rowEnd(index: number): [Text, number] {
  const nodes = textNodes(index);
  const last = nodes[nodes.length - 1];
  return [last, last.data.length];
}

function selectRows(from: number, to: number): void {
  const selection = document.getSelection();
  if (selection === null) throw new Error('no selection');
  const [anchorNode, anchorOffset] = rowStart(from);
  const [focusNode, focusOffset] = rowEnd(to);
  act(() => {
    selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

function copyFromViewer(): string {
  const viewer = document.querySelector<HTMLElement>('[data-component="LogViewer"]');
  if (viewer === null) throw new Error('viewer is not mounted');

  let written = '';
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (_type: string, value: string) => {
        written = value;
      },
    },
  });
  act(() => {
    viewer.dispatchEvent(event);
  });
  return written;
}

const readyRow = async (index: number): Promise<void> => {
  await waitFor(() => expect(rowElement(index).textContent).toContain(`message ${index}`));
};

describe('LogViewer selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    windowStart = 0;
    document.getSelection()?.removeAllRanges();

    fetchMock.mockImplementation((_url, options) => {
      const from = Number(options?.params?.from ?? 0);
      const count = Number(options?.params?.count ?? 0);
      const lines = Array.from({ length: Math.max(0, Math.min(count, TOTAL - from)) }, (_, at) =>
        lineText(from + at),
      );
      return Promise.resolve({ from, lines, total: TOTAL, size: 4096 } as never);
    });
  });

  it('copies the selected rows from the cache rather than the DOM', async () => {
    render(<Harness />);
    await readyRow(0);
    selectRows(1, 3);

    expect(copyFromViewer()).toBe([lineText(1), lineText(2), lineText(3)].join('\n'));
  });

  // ! The defect this guards: the anchor row unmounts on scroll, the browser truncates the range
  // ! to whatever is still mounted, and the copy silently comes back short.
  it('keeps the whole range after the anchor row scrolls out of the window', async () => {
    render(<Harness />);
    await readyRow(0);
    selectRows(1, 5);

    act(() => scrollTo(40));
    expect(document.querySelector('[data-index="1"]')).toBeNull();

    // ? The event the unmount queues. It reports the clamped range this hook wrote back during
    // ? the commit, and must not be mistaken for the reader redrawing the selection.
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(copyFromViewer()).toBe([1, 2, 3, 4, 5].map(lineText).join('\n'));
  });

  it('extends from the logical anchor when the reader shift-clicks a row further down', async () => {
    render(<Harness />);
    await readyRow(0);
    selectRows(1, 5);
    act(() => scrollTo(40));
    await readyRow(44);

    // ? What a shift-click reports: the anchor sits wherever the clamp left it, and the focus is
    // ? the row that was clicked.
    const selection = document.getSelection();
    if (selection === null) throw new Error('no selection');
    const [focusNode, focusOffset] = rowEnd(44);
    act(() => {
      selection.setBaseAndExtent(
        selection.anchorNode as Node,
        selection.anchorOffset,
        focusNode,
        focusOffset,
      );
      document.dispatchEvent(new Event('selectionchange'));
    });

    const copied = copyFromViewer();
    expect(copied.split('\n')[0]).toBe(lineText(1));
    expect(copied.endsWith(lineText(44))).toBe(true);
  });

  // ! A caret draws nothing, so it is easy to leave unprojected — and then a shift-click after a
  // ! scroll extends from whatever row the browser picked, not the one that was clicked.
  it('keeps a caret as the anchor for a shift-click made after scrolling', async () => {
    render(<Harness />);
    await readyRow(0);

    const selection = document.getSelection();
    if (selection === null) throw new Error('no selection');
    const [caretNode, caretOffset] = rowStart(1);
    act(() => {
      selection.collapse(caretNode, caretOffset);
      document.dispatchEvent(new Event('selectionchange'));
    });

    act(() => scrollTo(40));
    await readyRow(44);

    const [focusNode, focusOffset] = rowEnd(44);
    act(() => {
      selection.setBaseAndExtent(
        selection.anchorNode as Node,
        selection.anchorOffset,
        focusNode,
        focusOffset,
      );
      document.dispatchEvent(new Event('selectionchange'));
    });

    const copied = copyFromViewer().split('\n');
    expect(copied).toHaveLength(44);
    expect(copied[0]).toBe(lineText(1));
    expect(copied.at(-1)).toBe(lineText(44));
  });

  // ! Two extensions with no render between them: the first leaves the DOM already equal to the
  // ! clamp, so nothing is written — and if the clamp is not recorded on that path, the second
  // ! extension reads the clamped anchor as the reader's own and drops everything above it.
  it('survives a second shift-click made without an intervening change', async () => {
    render(<Harness />);
    await readyRow(0);

    const selection = document.getSelection();
    if (selection === null) throw new Error('no selection');
    const [caretNode, caretOffset] = rowStart(1);
    act(() => {
      selection.collapse(caretNode, caretOffset);
      document.dispatchEvent(new Event('selectionchange'));
    });

    act(() => scrollTo(40));
    await readyRow(48);

    const extendTo = (row: number): void => {
      const [focusNode, focusOffset] = rowEnd(row);
      act(() => {
        selection.setBaseAndExtent(
          selection.anchorNode as Node,
          selection.anchorOffset,
          focusNode,
          focusOffset,
        );
        document.dispatchEvent(new Event('selectionchange'));
      });
    };

    extendTo(44);
    extendTo(48);

    const copied = copyFromViewer().split('\n');
    expect(copied).toHaveLength(48);
    expect(copied[0]).toBe(lineText(1));
    expect(copied.at(-1)).toBe(lineText(48));
  });

  it('drops the selection when the reader presses inside the rows', async () => {
    render(<Harness />);
    await readyRow(0);
    selectRows(1, 3);
    expect(copyFromViewer()).not.toBe('');

    act(() => {
      rowElement(2).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });

    expect(copyFromViewer()).toBe('');
  });

  // ! A right-click keeps the DOM range so the context menu's Copy can act on it. Clearing the
  // ! logical range here would leave the highlight up and hand that Copy the mounted rows only.
  it('keeps the range when the reader opens a context menu over it', async () => {
    render(<Harness />);
    await readyRow(0);
    selectRows(1, 3);

    act(() => {
      rowElement(2).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }));
    });

    expect(copyFromViewer().split('\n')).toHaveLength(3);
  });

  // ! `selectionchange` is batched while the layout effect runs on every commit, so a render can
  // ! land between the reader's edit and its event. The projection must take that edit, not
  // ! overwrite it with the range it last knew about.
  it('keeps an extension made just before an unrelated render', async () => {
    render(<Harness />);
    await readyRow(0);
    selectRows(1, 3);

    const selection = document.getSelection();
    if (selection === null) throw new Error('no selection');
    const [focusNode, focusOffset] = rowEnd(5);
    act(() => {
      selection.setBaseAndExtent(
        selection.anchorNode as Node,
        selection.anchorOffset,
        focusNode,
        focusOffset,
      );
    });
    // ? The commit arrives first; the event that would have reported the edit comes after.
    act(() => scrollTo(0));
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
    });

    const copied = copyFromViewer().split('\n');
    expect(copied).toHaveLength(5);
    expect(copied.at(-1)).toBe(lineText(5));
  });

  // ! A range the browser dropped is churn, not intent: during a drag that auto-scrolls it fires
  // ! before the repair has had a chance to run, and treating it as a clear loses the drag.
  it('keeps the range when the browser discards the DOM selection', async () => {
    render(<Harness />);
    await readyRow(0);
    selectRows(1, 3);

    act(() => {
      document.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });

    expect(copyFromViewer().split('\n')).toHaveLength(3);
  });

  it('forgets the selection when the file changes', async () => {
    const { rerender } = render(<Viewer file="server.log" />);
    await readyRow(0);
    selectRows(1, 3);
    expect(copyFromViewer()).not.toBe('');

    rerender(<Viewer file="other.log" />);
    await readyRow(0);

    expect(copyFromViewer()).toBe('');
  });
});
