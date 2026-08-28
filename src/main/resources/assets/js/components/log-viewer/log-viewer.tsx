import { useVirtualizer } from '@tanstack/react-virtual';
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import type { LogLevel } from '../../lib/api/logs';
import type { LineCache } from './line-cache';
import type { ParsedLogLine } from './log-line';
import type { ReactElement, ReactNode, Ref } from 'react';

import { fetchLogLines, levelsParam } from '../../lib/api/logs';
import { cn } from '../../lib/utils';
import { createLineCache } from './line-cache';
import {
  LEVEL_EMPHASIS,
  LEVEL_TOKEN_CLASS,
  LOGGER_CLASS,
  TIME_CLASS,
  logLineClass,
  parseLogLine,
} from './log-line';

const LOG_VIEWER_NAME = 'LogViewer';
const LOG_ROW_NAME = 'LogRow';

// * Layout

// ? Row height in no-wrap mode. Must stay in sync with `leading-[18px]` below —
// ? the virtualizer trusts it instead of measuring, which is what keeps
// ? million-line files smooth.
const LINE_HEIGHT = 18;
const OVERSCAN = 20;

// ? `scrollTop` is fractional under browser zoom and non-integer DPR, so a
// ? viewport genuinely pinned to the bottom still reports a sub-pixel gap.
const BOTTOM_THRESHOLD_PX = 2;

// * Search highlighting

const MAX_HIGHLIGHT_LENGTH = 20_000;
const MAX_HIGHLIGHTS_PER_LINE = 200;

// ? No-wrap rows are laid out on one line, so an unbounded row would pin the
// ? horizontal scroll range at its width for the rest of the session.
const MAX_NOWRAP_CHARS = 10_000;

// ? Wrap mode has no such scroll range to protect, but a line of this size still costs hundreds
// ? of laid-out rows the virtualizer has to measure. `?action=download` serves the whole line.
const MAX_WRAP_CHARS = 100_000;

export type LineAlign = 'start' | 'center' | 'end' | 'auto';

export type LogViewerHandle = {
  scrollToLine: (line: number, align?: LineAlign) => void;
  /** Drop every cached chunk and refetch what is on screen. */
  reload: () => void;
  /** 0-based indices of the first and last rows currently at least partly visible; null when nothing is rendered. */
  getVisibleRange: () => { first: number; last: number } | null;
  /**
   * 0-based physical line number at a row index, or `undefined` when a filter is active and the
   * row's chunk has not landed. There is no honest fallback in that state: the row index is a
   * position in the filtered view, and handing it back as a line number sends searches and
   * anchors to the wrong part of the file.
   */
  getPhysicalLine: (index: number) => number | undefined;
};

export type LogViewerProps = {
  file: string;
  /** Levels the view admits. Selecting all of them, or none, is no filter at all. */
  levels: readonly LogLevel[];
  total: number;
  size: number;
  wrap: boolean;
  follow: boolean;
  /** Reports whether a user scroll left the viewport at the end of the file. */
  onAtBottomChange: (atBottom: boolean) => void;
  highlight?: RegExp | null;
  className?: string;
  ref?: Ref<LogViewerHandle>;
};

//
// * Line rendering
//

function renderLineText(text: string, highlight: RegExp | null): ReactNode {
  if (highlight === null || text.length === 0 || text.length > MAX_HIGHLIGHT_LENGTH) return text;

  highlight.lastIndex = 0;
  let match = highlight.exec(text);
  if (match === null) return text;

  const parts: ReactNode[] = [];
  let last = 0;
  let count = 0;

  while (match !== null && count < MAX_HIGHLIGHTS_PER_LINE) {
    if (match[0].length === 0) {
      highlight.lastIndex += 1;
      match = highlight.exec(text);
      continue;
    }
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <mark key={match.index} className="bg-warning/40 text-foreground rounded-xs">
        {match[0]}
      </mark>,
    );
    last = match.index + match[0].length;
    count += 1;
    match = highlight.exec(text);
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

// ! Every keystroke in the search box mints a new `highlight`, so every visible row re-counts its
// ! hidden tail — the whole line, for an oversized one. Past this the walk is the only thing
// ! anyone would notice, so the count falls back to UTF-16 units.
const MAX_COUNTED_TAIL = 1 << 16;

// ? `String` indices are UTF-16 units, so a blind cut at `limit` splits an
// ? astral character into a lone surrogate and the hidden count comes out too
// ? high. Cut before the pair and count what is left in code points.
function truncate(text: string, limit: number): { head: string; hidden: number } {
  const end = isHighSurrogate(text.charCodeAt(limit - 1)) ? limit - 1 : limit;
  const head = text.slice(0, end);

  const tail = text.length - end;
  if (tail > MAX_COUNTED_TAIL) return { head, hidden: tail };

  let hidden = 0;
  for (let i = end; i < text.length; i += 1) {
    if (isHighSurrogate(text.charCodeAt(i)) && isLowSurrogate(text.charCodeAt(i + 1))) i += 1;
    hidden += 1;
  }

  return { head, hidden };
}

/** Characters a whole row may render before the tail is replaced by a count. */
function lineBudget(wrap: boolean): number {
  return wrap ? MAX_WRAP_CHARS : MAX_NOWRAP_CHARS;
}

function renderMessage(message: string, highlight: RegExp | null, budget: number): ReactNode {
  // ! A prefix wider than the whole budget would leave `truncate` a negative limit, which slices
  // ! off the tail instead of the head.
  const limit = Math.max(0, budget);
  if (message.length <= limit) return renderLineText(message, highlight);
  const { head, hidden } = truncate(message, limit);
  return (
    <>
      {renderLineText(head, highlight)}
      <span className="text-muted-foreground select-none">{` … +${hidden} chars`}</span>
    </>
  );
}

// ? Segments are sliced out of the original text rather than rebuilt from the
// ? parsed parts, so the pattern's own padding survives and columns stay aligned.
function renderLineContent(
  text: string,
  parsed: ParsedLogLine,
  wrap: boolean,
  highlight: RegExp | null,
): ReactNode {
  if (parsed.kind === 'continuation') {
    return renderMessage(text, highlight, lineBudget(wrap));
  }

  const timeEnd = parsed.time.length;
  const levelEnd = timeEnd + 1 + parsed.level.length;
  const messageStart = text.length - parsed.message.length;

  return (
    <>
      <span className={TIME_CLASS}>{renderLineText(text.slice(0, timeEnd), highlight)}</span>
      <span className={cn(LEVEL_TOKEN_CLASS[parsed.level], LEVEL_EMPHASIS)}>
        {renderLineText(text.slice(timeEnd, levelEnd), highlight)}
      </span>
      <span className={LOGGER_CLASS}>
        {renderLineText(text.slice(levelEnd, messageStart), highlight)}
      </span>
      {renderMessage(parsed.message, highlight, lineBudget(wrap) - messageStart)}
    </>
  );
}

//
// * LogRow
//

type LogRowProps = {
  index: number;
  /** Physical line number, or `undefined` while a filtered row's chunk is still on its way. */
  lineNumber: number | undefined;
  text: string | undefined;
  wrap: boolean;
  highlight: RegExp | null;
  measureRef?: (node: HTMLDivElement | null) => void;
};

const LogRowBase = ({
  index,
  lineNumber,
  text,
  wrap,
  highlight,
  measureRef,
}: LogRowProps): ReactElement => {
  const parsed = text == null ? null : parseLogLine(text);

  const className = cn(
    'relative min-h-[18px] leading-[18px]',
    // ? Gutter is drawn by the pseudo-element so a text selection copies the
    // ? log line only, never the line numbers.
    'before:pointer-events-none before:w-[9ch] before:pr-[1ch] before:text-right',
    'before:text-muted-foreground before:tabular-nums before:select-none',
    'before:content-[attr(data-line)]',
    wrap
      ? 'w-full pl-[9ch] break-all whitespace-pre-wrap before:absolute before:left-0'
      : 'before:bg-background w-max min-w-full whitespace-pre before:sticky before:left-0 before:inline-block',
    parsed == null ? 'text-muted-foreground' : logLineClass(parsed),
  );

  // ! Blank rather than the row index: under a filter that index is not the line number, and
  // ! printing it would renumber the gutter the moment the chunk lands.
  const gutter = lineNumber == null ? '' : lineNumber + 1;

  const content =
    text == null || parsed == null ? (
      <span className="bg-muted-foreground/20 inline-block h-[9px] w-[36ch] animate-pulse rounded-xs align-middle" />
    ) : (
      renderLineContent(text, parsed, wrap, highlight)
    );

  return (
    <div
      ref={measureRef}
      data-component={LOG_ROW_NAME}
      data-index={index}
      data-line={gutter}
      className={className}
    >
      {content}
    </div>
  );
};

LogRowBase.displayName = LOG_ROW_NAME;

const LogRow = memo(LogRowBase);

//
// * LogViewer
//

export const LogViewer = ({
  ref,
  file,
  levels,
  total,
  size,
  wrap,
  follow,
  onAtBottomChange,
  highlight = null,
  className,
}: LogViewerProps): ReactElement => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef(file);
  const levelsRef = useRef(levels);
  const totalRef = useRef(total);
  const sizeRef = useRef(size);
  const atBottomChangeRef = useRef(onAtBottomChange);
  const rowsRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const programmaticRef = useRef(0);
  const pendingEndRef = useRef(true);
  // ? Held open between the jump to the end and the layout that jump was aiming at. See the
  // ? resize effect below for why the two are not the same moment.
  const pinnedRef = useRef(false);

  fileRef.current = file;
  levelsRef.current = levels;
  totalRef.current = total;
  sizeRef.current = size;
  atBottomChangeRef.current = onAtBottomChange;

  const cache = useMemo<LineCache>(
    () =>
      createLineCache({
        fetchChunk: ({ from, count, signal }) =>
          fetchLogLines(fileRef.current, from, count, levelsRef.current, signal),
      }),
    [],
  );

  // ? Two selections that filter the same way are the same view, so the canonical parameter is
  // ? what invalidates — not the array identity, which changes on every render.
  const levelsKey = levelsParam(levels) ?? '';
  const filtering = levelsKey !== '';

  // ? Every effect that reads cached content lists `version`: it is the only
  // ? signal that chunks landed, were dropped by a reload, or became retryable.
  const version = useSyncExternalStore(cache.subscribe, cache.getVersion, cache.getVersion);

  const [minWidth, setMinWidth] = useState(0);

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  const virtualItems = virtualizer.getVirtualItems();

  const holdProgrammatic = useCallback(() => {
    programmaticRef.current += 1;
    const release = (): void => {
      programmaticRef.current = Math.max(0, programmaticRef.current - 1);
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(release));
    } else {
      setTimeout(release, 0);
    }
  }, []);

  const scrollToLine = useCallback(
    (line: number, align: LineAlign = 'center') => {
      const count = totalRef.current;
      if (count === 0) return;
      const index = Math.max(0, Math.min(line, count - 1));
      pinnedRef.current = false;
      holdProgrammatic();
      virtualizerRef.current.scrollToIndex(index, { align });
    },
    [holdProgrammatic],
  );

  // ! Not `scrollToIndex(total - 1, 'end')`: that resolves the last row's offset against the
  // ! sizes the virtualizer holds *now*, and on a file switch those are provisional — `minWidth`
  // ! is back to 0 so no horizontal scrollbar has shortened `clientHeight`, and in wrap mode no
  // ! row has been measured. Reading the live `scrollHeight` instead is what makes the target
  // ! the bottom as it currently stands rather than as the estimates predicted it.
  const snapToEnd = useCallback(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const target = Math.max(0, element.scrollHeight - element.clientHeight);
    if (Math.abs(element.scrollTop - target) <= BOTTOM_THRESHOLD_PX) return;
    holdProgrammatic();
    element.scrollTop = target;
  }, [holdProgrammatic]);

  const scrollToEnd = useCallback(() => {
    pinnedRef.current = true;
    snapToEnd();
  }, [snapToEnd]);

  const getPhysicalLine = useCallback(
    (index: number): number | undefined => (filtering ? cache.getLineNumber(index) : index),
    [cache, filtering],
  );

  const getVisibleRange = useCallback((): { first: number; last: number } | null => {
    const element = scrollRef.current;
    if (element === null) return null;
    const top = element.scrollTop;
    const bottom = top + element.clientHeight;
    let first: number | null = null;
    let last: number | null = null;
    for (const item of virtualizerRef.current.getVirtualItems()) {
      if (item.start >= bottom || item.start + item.size <= top) continue;
      if (first === null) first = item.index;
      last = item.index;
    }
    if (first === null || last === null) return null;
    return { first, last };
  }, []);

  // ? Reported on every user scroll rather than on transitions: tracking the
  // ? last value would miss one that flipped during a programmatic scroll.
  const handleScroll = useCallback(() => {
    if (programmaticRef.current > 0) return;
    const element = scrollRef.current;
    if (element === null) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    atBottomChangeRef.current(distance <= BOTTOM_THRESHOLD_PX);
  }, []);

  // ! A scroll event cannot say who caused it, and while the layout settles most of them are
  // ! not the reader: the virtualizer re-scrolls on its own to hold the view steady as rows
  // ! it had only estimated report their real heights. Ending the pin on those would abandon
  // ! the jump exactly where the defect leaves it. A gesture is the reader, unambiguously.
  const handleGesture = useCallback(() => {
    pinnedRef.current = false;
  }, []);

  const activeHighlight = useMemo(() => {
    if (highlight == null) return null;
    return highlight.global ? highlight : new RegExp(highlight.source, `${highlight.flags}g`);
  }, [highlight]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToLine,
      getVisibleRange,
      getPhysicalLine,
      reload: () => {
        cache.reset();
        cache.setTotal(totalRef.current, sizeRef.current);
      },
    }),
    [cache, getPhysicalLine, getVisibleRange, scrollToLine],
  );

  useEffect(() => cache.destroy, [cache]);

  // ! The end is not where it will be when the jump fires. The rows under it are still
  // ! skeletons, so none has been measured for wrap and none is wide enough yet to have pulled
  // ! the horizontal scrollbar in to shorten the viewport — both arrive with the text, a fetch
  // ! later, and both move the bottom out from under a jump that has already landed. Holding
  // ! the request open and re-aiming it on every geometry change is what makes the difference
  // ! between the end of the file and a last line cropped behind a scrollbar. The two observed
  // ! nodes are the two terms of the target: the sizer's height *is* `scrollHeight`, and the
  // ! scroll element's box is what a scrollbar takes `clientHeight` out of.
  useEffect(() => {
    const element = scrollRef.current;
    const sizer = sizerRef.current;
    if (element === null || sizer === null) return;
    if (typeof ResizeObserver !== 'function') return;

    const observer = new ResizeObserver(() => {
      if (!pinnedRef.current) return;
      snapToEnd();
    });
    observer.observe(element);
    observer.observe(sizer);
    return () => observer.disconnect();
  }, [snapToEnd]);

  // ? File switch: everything cached, measured and sized belongs to the old file.
  // ? Vertical position is left to the pending jump, once the new count is known.
  useEffect(() => {
    cache.reset();
    cache.setTotal(totalRef.current, sizeRef.current);
    setMinWidth(0);
    virtualizerRef.current.measure();
    pendingEndRef.current = true;
    pinnedRef.current = false;
    if (scrollRef.current !== null) scrollRef.current.scrollLeft = 0;
  }, [cache, file]);

  // ? A filter change re-indexes the view, so everything cached, measured and sized belongs to
  // ? the old one. Vertical position is deliberately left alone: the page restores it from an
  // ? anchor line, which the viewer has no way to know about.
  useEffect(() => {
    cache.reset();
    cache.setTotal(totalRef.current, sizeRef.current);
    setMinWidth(0);
    virtualizerRef.current.measure();
  }, [cache, levelsKey]);

  useEffect(() => {
    cache.setTotal(total, size);
  }, [cache, total, size]);

  // ? Wrap toggle invalidates every measured row height.
  useEffect(() => {
    virtualizerRef.current.measure();
  }, [wrap]);

  useEffect(() => {
    if (virtualItems.length === 0) return;
    const first = virtualItems[0].index;
    const last = virtualItems[virtualItems.length - 1].index;
    cache.ensureRange(first, last);
  }, [cache, virtualItems, version]);

  // ? Widest row measured so far drives the inner width, so the horizontal
  // ? scroll range grows monotonically instead of collapsing when a very long
  // ? line leaves the window. Measured, not counted: CJK and emoji are wider
  // ? than a `ch`, so a character count would fall short of what is painted.
  useEffect(() => {
    if (wrap) return;
    const rows = rowsRef.current;
    if (rows === null || rows.scrollWidth <= rows.clientWidth) return;
    setMinWidth(rows.scrollWidth);
  }, [virtualItems, version, wrap]);

  useEffect(() => {
    if (total === 0) return;
    if (follow || pendingEndRef.current) {
      pendingEndRef.current = false;
      scrollToEnd();
      return;
    }
    // ! Lines appended to the file are not the layout settling under the last jump, and chasing
    // ! them is what follow is for. Without this the pin outlives its purpose and quietly
    // ! follows a file the reader turned following off for.
    pinnedRef.current = false;
  }, [follow, total, scrollToEnd]);

  const measureRef = wrap ? virtualizer.measureElement : undefined;

  const containerClass = cn(
    'bg-background text-foreground focus-visible:ring-ring relative font-mono text-xs tabular-nums focus-visible:ring-1 focus-visible:outline-none',
    wrap ? 'overflow-x-hidden overflow-y-auto' : 'overflow-auto',
    className,
  );

  return (
    <div
      ref={scrollRef}
      data-component={LOG_VIEWER_NAME}
      tabIndex={0}
      onScroll={handleScroll}
      onWheel={handleGesture}
      onPointerDown={handleGesture}
      onKeyDown={handleGesture}
      className={containerClass}
    >
      <div
        ref={sizerRef}
        className="relative w-full"
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          minWidth: wrap ? undefined : `${minWidth}px`,
        }}
      >
        {/* ? Rows stay in normal flow inside one translated wrapper: absolutely
            positioned siblings make a text selection copy as a single run-on line. */}
        <div
          ref={rowsRef}
          className="absolute top-0 left-0 w-full"
          style={{ transform: `translateY(${virtualItems[0]?.start ?? 0}px)` }}
        >
          {virtualItems.map((item) => (
            <LogRow
              key={item.key}
              index={item.index}
              lineNumber={getPhysicalLine(item.index)}
              text={cache.getLine(item.index)}
              wrap={wrap}
              highlight={activeHighlight}
              measureRef={measureRef}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

LogViewer.displayName = LOG_VIEWER_NAME;
