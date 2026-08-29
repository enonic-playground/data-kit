//
// * Line-space selection model
//
// A selection over a virtualized log, held as row indices rather than DOM nodes. Rows unmount
// as they scroll out and take any DOM `Selection` endpoint anchored to them with them, so the
// range the reader drew has to survive somewhere the virtualizer cannot reach.
//
// Indices are positions in the *view*: under a level filter they are not physical line numbers.
// Nothing here translates between the two — the buffer, the fetch and the copy all speak the
// same index space the rows do.
//
// Deliberately React-free and DOM-free so it can be unit-tested on its own.
//

/** Lines a selection may hold before further ones are dropped. */
export const MAX_SELECTION_LINES = 100_000;

/** Characters a selection may hold before further ones are dropped. */
export const MAX_SELECTION_CHARS = 20_000_000;

export type SelectionPoint = {
  /** Row index in the view. */
  index: number;
  /** Character offset into that row's full text. */
  offset: number;
};

/** Where the selection started and where it currently ends; `focus` may precede `anchor`. */
export type LogSelection = {
  anchor: SelectionPoint;
  focus: SelectionPoint;
};

/** A selection in document order. */
export type SelectionSpan = {
  start: SelectionPoint;
  end: SelectionPoint;
};

export type SerializedSelection = {
  text: string;
  /** Lines that had text to contribute. */
  copied: number;
  /** Lines the span covers. */
  total: number;
};

export function comparePoints(a: SelectionPoint, b: SelectionPoint): number {
  if (a.index !== b.index) return a.index - b.index;
  return a.offset - b.offset;
}

export function samePoint(a: SelectionPoint | null, b: SelectionPoint | null): boolean {
  if (a === null || b === null) return a === b;
  return a.index === b.index && a.offset === b.offset;
}

export function orderSpan(selection: LogSelection): SelectionSpan {
  const { anchor, focus } = selection;
  return comparePoints(anchor, focus) <= 0
    ? { start: anchor, end: focus }
    : { start: focus, end: anchor };
}

export function isCollapsed(selection: LogSelection): boolean {
  return comparePoints(selection.anchor, selection.focus) === 0;
}

/** Rows the span touches, both ends included. */
export function spanLength(span: SelectionSpan): number {
  return span.end.index - span.start.index + 1;
}

/**
 * The selected text, taken from `getLine` rather than from the DOM — which holds only the rows
 * still mounted, and holds oversized ones truncated.
 *
 * A line the buffer never got is skipped rather than substituted: `copied` against `total` is
 * what tells the caller the result is short, and a placeholder would put text on the clipboard
 * that was never in the file.
 */
export function serializeSelection(
  span: SelectionSpan,
  getLine: (index: number) => string | undefined,
): SerializedSelection {
  const total = spanLength(span);
  const parts: string[] = [];
  let copied = 0;

  // ! `copy` is synchronous, and a span can cover the whole file — walking millions of indices
  // ! for lines the buffer was never allowed to hold would stall the keypress. `total` still
  // ! reports the whole span, so the shortfall is what raises the warning.
  const last = Math.min(span.end.index, span.start.index + MAX_SELECTION_LINES - 1);

  for (let index = span.start.index; index <= last; index += 1) {
    const line = getLine(index);
    if (line === undefined) continue;

    const from = index === span.start.index ? Math.min(span.start.offset, line.length) : 0;
    const to = index === span.end.index ? Math.min(span.end.offset, line.length) : line.length;
    parts.push(line.slice(from, Math.max(from, to)));
    copied += 1;
  }

  return { text: parts.join('\n'), copied, total };
}
