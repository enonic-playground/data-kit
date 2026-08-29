import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { LogSelection, SelectionPoint, SelectionSpan } from './selection';
import type { ClipboardEvent, RefObject } from 'react';

import { toast } from '../ui/sonner';
import {
  MAX_SELECTION_CHARS,
  MAX_SELECTION_LINES,
  isCollapsed,
  orderSpan,
  samePoint,
  serializeSelection,
} from './selection';

// ? The server caps a line request at 1000, so a long span is a paged sequence either way.
const FETCH_PAGE = 1000;

// ? Long enough that a drag does not mint a request per frame, short enough that letting go of
// ? the mouse and reaching for Ctrl+C leaves the fill a head start.
const FILL_DELAY_MS = 150;

/** What the DOM selection currently says, in row-index space. */
type DomSelection = {
  /** `true` when the document holds no range at all. */
  empty: boolean;
  /** `null` when the endpoint is not inside a log row — dragged into the toolbar, say. */
  anchor: SelectionPoint | null;
  focus: SelectionPoint | null;
  /** An endpoint still pointing at a node the virtualizer has unmounted. */
  detached: boolean;
  /** The nodes the endpoints sat on, kept so a later commit can be asked whether they survived. */
  anchorNode: Node | null;
  focusNode: Node | null;
};

const EMPTY_DOM_SELECTION: DomSelection = {
  empty: true,
  anchor: null,
  focus: null,
  detached: false,
  anchorNode: null,
  focusNode: null,
};

export type UseLogSelectionParams = {
  rowsRef: RefObject<HTMLDivElement | null>;
  /** Cached text of a row, when the viewer happens to hold it. */
  getLine: (index: number) => string | undefined;
  fetchLines: (from: number, count: number, signal: AbortSignal) => Promise<string[]>;
  /**
   * Changes whenever row indices stop meaning what they meant — a file switch, or a filter
   * change that re-indexes the view. Both invalidate a selection outright.
   */
  resetKey: string;
};

export type UseLogSelectionResult = {
  onCopy: (event: ClipboardEvent<HTMLDivElement>) => void;
};

//
// * DOM <-> line space
//

function rowIndex(row: HTMLElement): number | null {
  const raw = row.dataset.index;
  if (raw == null) return null;
  const index = Number(raw);
  return Number.isInteger(index) ? index : null;
}

function childAt(rows: HTMLElement, position: number): HTMLElement | null {
  const child = rows.children.item(position);
  return child instanceof HTMLElement ? child : null;
}

function rowElement(rows: HTMLElement, index: number): HTMLElement | null {
  for (let position = 0; position < rows.children.length; position += 1) {
    const child = childAt(rows, position);
    if (child !== null && rowIndex(child) === index) return child;
  }
  return null;
}

function resolveRow(rows: HTMLElement, node: Node, offset: number): HTMLElement | null {
  if (node === rows) return childAt(rows, Math.min(offset, rows.children.length - 1));
  const element = node instanceof Element ? node : node.parentElement;
  const row = element?.closest<HTMLElement>('[data-index]') ?? null;
  return row !== null && rows.contains(row) ? row : null;
}

/**
 * Characters of `row` that precede the DOM position. Measured with a `Range` rather than by
 * walking, so the split into time/level/logger spans and `<mark>` elements costs nothing — and
 * so the `::before` gutter, which is not text, stays out of the count.
 */
function offsetWithin(row: HTMLElement, node: Node, offset: number): number {
  const range = row.ownerDocument.createRange();
  range.selectNodeContents(row);
  try {
    range.setEnd(node, offset);
  } catch {
    return row.textContent?.length ?? 0;
  }
  return range.toString().length;
}

function pointAt(rows: HTMLElement, node: Node | null, offset: number): SelectionPoint | null {
  if (node === null) return null;
  const row = resolveRow(rows, node, offset);
  if (row === null) return null;
  const index = rowIndex(row);
  if (index === null) return null;

  // ? An endpoint on the container itself sits between rows: it is the start of the row it
  // ? resolved to, or the end of that row when the position is past it.
  if (node === rows) {
    const position = Array.prototype.indexOf.call(rows.children, row);
    return { index, offset: offset > position ? (row.textContent?.length ?? 0) : 0 };
  }

  return { index, offset: offsetWithin(row, node, offset) };
}

function readDomSelection(rows: HTMLElement): DomSelection {
  const selection = rows.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) return EMPTY_DOM_SELECTION;
  const { anchorNode, focusNode } = selection;
  return {
    empty: false,
    anchor: pointAt(rows, anchorNode, selection.anchorOffset),
    focus: pointAt(rows, focusNode, selection.focusOffset),
    detached:
      (anchorNode !== null && !anchorNode.isConnected) ||
      (focusNode !== null && !focusNode.isConnected),
    anchorNode,
    focusNode,
  };
}

function sameDomSelection(a: DomSelection | null, b: DomSelection | null): boolean {
  if (a === null || b === null) return a === b;
  return a.empty === b.empty && samePoint(a.anchor, b.anchor) && samePoint(a.focus, b.focus);
}

function sameSelection(a: LogSelection | null, b: LogSelection | null): boolean {
  if (a === null || b === null) return a === b;
  return samePoint(a.anchor, b.anchor) && samePoint(a.focus, b.focus);
}

/** DOM position `offset` characters into `row`, clamped to what the row actually renders. */
function domPosition(row: HTMLElement, offset: number): { node: Node; offset: number } {
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let last: Text | null = null;

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    if (remaining <= text.data.length) return { node: text, offset: remaining };
    remaining -= text.data.length;
    last = text;
  }

  return last === null ? { node: row, offset: 0 } : { node: last, offset: last.data.length };
}

/** The DOM selection's own focus, when it still points inside a mounted row. */
function liveFocus(
  rows: HTMLElement,
  selection: Selection,
): { node: Node; offset: number } | null {
  const node = selection.focusNode;
  if (node === null || !rows.contains(node)) return null;
  return { node, offset: selection.focusOffset };
}

//
// * Hook
//

/**
 * Holds the selection in row-index space so it survives the rows that drew it.
 *
 * Three parts hang together. The logical range lives in a ref, updated from `selectionchange`.
 * After every render it is projected back onto the mounted window, clamped at both ends, which
 * both repairs whatever the virtualizer did to the DOM range and leaves every row between the
 * clamps inside the native range — so the browser paints them and no highlight of our own is
 * needed. And because the span is buffered while the selection is still live, `copy` — which
 * cannot wait for a fetch — has the text to hand.
 */
export function useLogSelection({
  rowsRef,
  getLine,
  fetchLines,
  resetKey,
}: UseLogSelectionParams): UseLogSelectionResult {
  const { t } = useTranslation();

  const selectionRef = useRef<LogSelection | null>(null);
  // ? The DOM state this hook last wrote. Anything else `selectionchange` reports is the reader.
  const projectedRef = useRef<DomSelection | null>(null);
  const bufferRef = useRef(new Map<number, string>());
  const bufferCharsRef = useRef(0);
  const spanRef = useRef<SelectionSpan | null>(null);
  const fillAbortRef = useRef<AbortController | null>(null);
  const fillTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draggingRef = useRef(false);

  const getLineRef = useRef(getLine);
  const fetchLinesRef = useRef(fetchLines);
  getLineRef.current = getLine;
  fetchLinesRef.current = fetchLines;

  const clearBuffer = useCallback(() => {
    fillAbortRef.current?.abort();
    fillAbortRef.current = null;
    clearTimeout(fillTimerRef.current);
    fillTimerRef.current = undefined;
    bufferRef.current.clear();
    bufferCharsRef.current = 0;
    spanRef.current = null;
  }, []);

  // ? The budget is checked against the line being added, not against the total so far — one
  // ? oversized line would otherwise overshoot the cap by its own length. A first line larger
  // ? than the whole budget is still taken, so a single huge line is never uncopyable.
  const remember = useCallback((index: number, line: string): boolean => {
    const buffer = bufferRef.current;
    if (buffer.has(index)) return true;
    if (buffer.size >= MAX_SELECTION_LINES) return false;
    if (buffer.size > 0 && bufferCharsRef.current + line.length > MAX_SELECTION_CHARS) return false;
    buffer.set(index, line);
    bufferCharsRef.current += line.length;
    return true;
  }, []);

  const runFill = useCallback(async (): Promise<void> => {
    const selection = selectionRef.current;
    if (selection === null || isCollapsed(selection)) return;

    const span = orderSpan(selection);
    fillAbortRef.current?.abort();
    const controller = new AbortController();
    fillAbortRef.current = controller;

    let index = span.start.index;
    while (index <= span.end.index && !controller.signal.aborted) {
      if (bufferRef.current.has(index)) {
        index += 1;
        continue;
      }

      let count = 0;
      while (
        count < FETCH_PAGE &&
        index + count <= span.end.index &&
        !bufferRef.current.has(index + count)
      ) {
        count += 1;
      }

      const lines = await fetchLinesRef.current(index, count, controller.signal);
      if (controller.signal.aborted) return;
      // ! An empty page means the server has nothing more for this range; looping on it would
      // ! spin forever against a span that reaches past the end of the file.
      if (lines.length === 0) return;

      for (const [position, line] of lines.entries()) {
        if (!remember(index + position, line)) return;
      }
      index += lines.length;
    }
  }, [remember]);

  const scheduleFill = useCallback(() => {
    // ! Aborted here rather than inside `runFill`: a page still in flight for the previous span
    // ! would otherwise land during the debounce and spend the caps on lines nobody selected.
    fillAbortRef.current?.abort();
    fillAbortRef.current = null;
    clearTimeout(fillTimerRef.current);
    fillTimerRef.current = setTimeout(() => {
      // ? A failed page leaves the buffer short; the copy reports that rather than retrying.
      void runFill().catch(() => {});
    }, FILL_DELAY_MS);
  }, [runFill]);

  /** Drop what the selection no longer covers, so a redrawn range does not keep paying for it. */
  const pruneBuffer = useCallback((span: SelectionSpan) => {
    const previous = spanRef.current;
    spanRef.current = span;
    if (
      previous === null ||
      (span.start.index <= previous.start.index && span.end.index >= previous.end.index)
    ) {
      return;
    }

    const buffer = bufferRef.current;
    for (const [index, line] of buffer) {
      if (index >= span.start.index && index <= span.end.index) continue;
      buffer.delete(index);
      bufferCharsRef.current -= line.length;
    }
  }, []);

  const setSelection = useCallback(
    (next: LogSelection | null) => {
      if (sameSelection(next, selectionRef.current)) return;
      selectionRef.current = next;

      if (next === null || isCollapsed(next)) {
        clearBuffer();
        return;
      }
      pruneBuffer(orderSpan(next));
      scheduleFill();
    },
    [clearBuffer, pruneBuffer, scheduleFill],
  );

  /**
   * Copies the mounted rows the selection covers out of the line cache. That cache evicts at a
   * fixed number of chunks, so a span dragged past that limit would otherwise lose its head —
   * and the rows in danger are exactly the ones on screen now.
   */
  const snapshotMounted = useCallback(() => {
    const selection = selectionRef.current;
    const rows = rowsRef.current;
    if (selection === null || rows === null || isCollapsed(selection)) return;

    const span = orderSpan(selection);
    for (let position = 0; position < rows.children.length; position += 1) {
      const child = childAt(rows, position);
      if (child === null) continue;
      const index = rowIndex(child);
      if (index === null || index < span.start.index || index > span.end.index) continue;
      const line = getLineRef.current(index);
      if (line !== undefined) remember(index, line);
    }
  }, [remember, rowsRef]);

  /** Takes what the DOM now says as the reader's intent, keeping the logical points behind clamps. */
  const syncFromDom = useCallback(() => {
    const rows = rowsRef.current;
    if (rows === null) return;

    const state = readDomSelection(rows);
    const projected = projectedRef.current;
    if (sameDomSelection(state, projected)) return;

    // ! No range at all is the browser discarding one whose rows went away; during a
    // ! drag-autoscroll it beats the repair. Clearing is `pointerdown`'s job, not this.
    if (state.empty) return;

    const current = selectionRef.current;
    if (state.anchor === null && state.focus === null) {
      // ! Neither endpoint landed in a row. A detached node, or a gesture still running, is the
      // ! virtualizer; anything else is the reader selecting elsewhere.
      if (state.detached || draggingRef.current) return;
      setSelection(null);
      projectedRef.current = state;
      return;
    }

    // ? An endpoint equal to the one last projected has not moved — it is the clamp, so the
    // ? logical point behind it stands. `null` means it left the rows; keep what we had.
    const pick = (
      dom: SelectionPoint | null,
      clamp: SelectionPoint | null,
      logical: SelectionPoint | undefined,
    ): SelectionPoint | null => {
      if (dom === null) return logical ?? null;
      if (samePoint(dom, clamp)) return logical ?? dom;
      return dom;
    };

    const anchor = pick(state.anchor, projected?.anchor ?? null, current?.anchor);
    const focus = pick(state.focus, projected?.focus ?? null, current?.focus);
    if (anchor === null || focus === null) return;

    // ! The adopted state becomes the new reference, never `null`: its anchor is the clamp the
    // ! next edit reports back, and forgetting it makes that edit adopt the clamp as the anchor.
    projectedRef.current = state;
    setSelection({ anchor, focus });
    // ? Nothing re-renders on a selection change — the range lives in a ref — so the rows on
    // ? screen have to be taken now rather than waiting for the layout effect to come round.
    snapshotMounted();
  }, [rowsRef, setSelection, snapshotMounted]);

  /**
   * Writes the logical range back onto the mounted window. An endpoint whose row is gone is
   * clamped to the edge of that window; a range that has scrolled out entirely clamps to a
   * collapsed one, which paints nothing and leaves the logical range untouched.
   *
   * A caret is projected as well as a range. It draws nothing, but it is the anchor a later
   * shift-click extends from — leave it in the row that unmounted and the browser picks its own,
   * and the reader gets the visible tail of what they asked for.
   */
  const project = useCallback(() => {
    const rows = rowsRef.current;
    const selection = selectionRef.current;
    if (rows === null || selection === null) return;

    const domSelection = rows.ownerDocument.getSelection();
    if (domSelection === null) return;

    // ! Damage is read off the nodes last seen, not off the range: a `Range` is live, so one the
    // ! virtualizer wrecked still looks well-formed. Nodes intact means the reader moved it —
    // ! possibly by an edit `selectionchange` has not delivered yet.
    const known = projectedRef.current;
    const intact =
      known?.anchorNode?.isConnected === true && known.focusNode?.isConnected === true;
    if (intact && !sameDomSelection(readDomSelection(rows), known)) {
      syncFromDom();
      return;
    }

    const first = childAt(rows, 0);
    const last = childAt(rows, rows.children.length - 1);
    if (first === null || last === null) return;
    const firstIndex = rowIndex(first);
    const lastIndex = rowIndex(last);
    if (firstIndex === null || lastIndex === null) return;

    const resolve = (point: SelectionPoint): { node: Node; offset: number } => {
      if (point.index < firstIndex) return domPosition(first, 0);
      if (point.index > lastIndex) return domPosition(last, Number.MAX_SAFE_INTEGER);
      const row = rowElement(rows, point.index);
      return row === null ? domPosition(first, 0) : domPosition(row, point.offset);
    };

    const anchor = resolve(selection.anchor);
    // ! Mid-drag the browser owns the moving end and recomputes it from its own base each move,
    // ! so only the anchor is repaired — writing the focus would rewind the drag.
    const dragFocus = draggingRef.current ? liveFocus(rows, domSelection) : null;
    const focus = dragFocus ?? resolve(selection.focus);

    const settled =
      domSelection.anchorNode === anchor.node &&
      domSelection.anchorOffset === anchor.offset &&
      domSelection.focusNode === focus.node &&
      domSelection.focusOffset === focus.offset;
    if (!settled) domSelection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);

    // ! Recorded on both paths: this is the only thing that later tells a clamp from an endpoint
    // ! the reader moved.
    projectedRef.current = readDomSelection(rows);
  }, [rowsRef, syncFromDom]);

  // ? No dependency list: every render is one the virtualizer may have changed rows in, and
  // ? repairing synchronously here means the queued `selectionchange` already reads the fix.
  useLayoutEffect(() => {
    project();
    snapshotMounted();
  });

  useEffect(() => {
    const owner = rowsRef.current?.ownerDocument ?? globalThis.document;
    owner.addEventListener('selectionchange', syncFromDom);
    return () => owner.removeEventListener('selectionchange', syncFromDom);
  }, [rowsRef, syncFromDom]);

  useEffect(() => {
    const rows = rowsRef.current;

    // ! A plain press starts a new selection, so the old one is gone the moment the button goes
    // ! down. Without this, pressing exactly where an off-screen range was clamped reproduces the
    // ! projected state, `selectionchange` reads it as our own repair, and the stale range copies.
    const handlePointerDown = (event: PointerEvent): void => {
      // ! Primary button only — a right-click keeps the range for the context menu's Copy, so
      // ! clearing here would strand that Copy with the mounted rows alone.
      if (event.button !== 0) return;
      draggingRef.current = true;
      if (event.shiftKey) return;
      const target = event.target;
      if (target instanceof Node && rows?.contains(target) === true) setSelection(null);
    };

    // ! The browser owned the moving end for the whole drag, so its final position is the
    // ! reader's — take it before re-clamping, or the range ends wherever the last render left it.
    // ? `project` adopts an undamaged DOM range itself, so this both takes the browser's final
    // ? position and re-clamps whatever the last scroll left behind.
    const handlePointerUp = (): void => {
      draggingRef.current = false;
      project();
    };

    // ! `pointerup` never fires for a gesture the browser takes away, and the flag would latch
    // ! on — after which nothing the reader selects elsewhere can clear this.
    const handlePointerCancel = (): void => {
      draggingRef.current = false;
    };

    const owner = rows?.ownerDocument ?? globalThis.document;
    owner.addEventListener('pointerdown', handlePointerDown);
    owner.addEventListener('pointerup', handlePointerUp);
    owner.addEventListener('pointercancel', handlePointerCancel);
    owner.defaultView?.addEventListener('blur', handlePointerCancel);
    return () => {
      owner.removeEventListener('pointerdown', handlePointerDown);
      owner.removeEventListener('pointerup', handlePointerUp);
      owner.removeEventListener('pointercancel', handlePointerCancel);
      owner.defaultView?.removeEventListener('blur', handlePointerCancel);
    };
  }, [project, rowsRef, setSelection, syncFromDom]);

  useEffect(() => {
    const rows = rowsRef.current;
    selectionRef.current = null;
    projectedRef.current = null;
    clearBuffer();

    const domSelection = rows?.ownerDocument.getSelection() ?? null;
    if (domSelection === null || rows === null) return;
    if (rows.contains(domSelection.anchorNode)) domSelection.removeAllRanges();
  }, [clearBuffer, resetKey, rowsRef]);

  useEffect(() => clearBuffer, [clearBuffer]);

  const onCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const selection = selectionRef.current;
      if (selection === null || isCollapsed(selection)) return;

      // ! Cache first, buffer second. The trailing chunk is mutable — a partial last line grows
      // ! and the cache refetches it — so a buffer entry taken before that lands would put a
      // ! truncated copy of a line on the clipboard while the row on screen shows it whole.
      const result = serializeSelection(
        orderSpan(selection),
        (index) => getLineRef.current(index) ?? bufferRef.current.get(index),
      );
      // ! Cancelled even with nothing to give: the native copy would yield whatever the mounted
      // ! rows spell, not what was selected. Cancelling without writing leaves the clipboard as is.
      event.preventDefault();
      if (result.copied === 0) {
        toast.warning(t('logs.toast.copyPending'));
        return;
      }

      event.clipboardData.setData('text/plain', result.text);

      if (result.copied < result.total) {
        toast.warning(
          t('logs.toast.copyPartial', {
            copied: result.copied.toLocaleString(),
            total: result.total.toLocaleString(),
          }),
        );
      }
    },
    [t],
  );

  return { onCopy };
}
