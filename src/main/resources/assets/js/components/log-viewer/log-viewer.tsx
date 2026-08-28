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

import type { LineCache } from './line-cache';
import type { ReactElement, ReactNode, Ref } from 'react';

import { fetchLogLines } from '../../lib/api/logs';
import { cn } from '../../lib/utils';
import { createLineCache } from './line-cache';
import { logLineClass, parseLogLine } from './log-line';

const LOG_VIEWER_NAME = 'LogViewer';
const LOG_ROW_NAME = 'LogRow';

// * Layout

// ? Row height in no-wrap mode. Must stay in sync with `leading-[18px]` below —
// ? the virtualizer trusts it instead of measuring, which is what keeps
// ? million-line files smooth.
const LINE_HEIGHT = 18;
const OVERSCAN = 20;

const BOTTOM_THRESHOLD_PX = 4;

// * Search highlighting

const MAX_HIGHLIGHT_LENGTH = 20_000;
const MAX_HIGHLIGHTS_PER_LINE = 200;

// ? No-wrap rows are laid out on one line, so an unbounded row would pin the
// ? horizontal scroll range at its width for the rest of the session. Wrap mode
// ? renders the line in full — that is the way to read one this long.
const MAX_NOWRAP_CHARS = 10_000;

export type LineAlign = 'start' | 'center' | 'end' | 'auto';

export type LogViewerHandle = {
  scrollToLine: (line: number, align?: LineAlign) => void;
  /** Drop every cached chunk and refetch what is on screen. */
  reload: () => void;
  /** 0-based indices of the first and last rows currently at least partly visible; null when nothing is rendered. */
  getVisibleRange: () => { first: number; last: number } | null;
};

export type LogViewerProps = {
  file: string;
  total: number;
  size: number;
  wrap: boolean;
  follow: boolean;
  onUserScrollAway: () => void;
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

// ? `String` indices are UTF-16 units, so a blind cut at `MAX_NOWRAP_CHARS`
// ? splits an astral character into a lone surrogate and the hidden count comes
// ? out too high. Cut before the pair and count what is left in code points.
function truncateForNowrap(text: string): { head: string; hidden: number } {
  const end = isHighSurrogate(text.charCodeAt(MAX_NOWRAP_CHARS - 1))
    ? MAX_NOWRAP_CHARS - 1
    : MAX_NOWRAP_CHARS;

  let hidden = 0;
  for (let i = end; i < text.length; i += 1) {
    if (isHighSurrogate(text.charCodeAt(i)) && isLowSurrogate(text.charCodeAt(i + 1))) i += 1;
    hidden += 1;
  }

  return { head: text.slice(0, end), hidden };
}

function renderLineContent(text: string, wrap: boolean, highlight: RegExp | null): ReactNode {
  if (wrap || text.length <= MAX_NOWRAP_CHARS) return renderLineText(text, highlight);
  const { head, hidden } = truncateForNowrap(text);
  return (
    <>
      {renderLineText(head, highlight)}
      <span className="text-muted-foreground select-none">{` … +${hidden} chars`}</span>
    </>
  );
}

//
// * LogRow
//

type LogRowProps = {
  index: number;
  text: string | undefined;
  wrap: boolean;
  highlight: RegExp | null;
  measureRef?: (node: HTMLDivElement | null) => void;
};

const LogRowBase = ({ index, text, wrap, highlight, measureRef }: LogRowProps): ReactElement => {
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
    text === undefined ? 'text-muted-foreground' : logLineClass(parseLogLine(text)),
  );

  const content =
    text === undefined ? (
      <span className="bg-muted-foreground/20 inline-block h-[9px] w-[36ch] animate-pulse rounded-xs align-middle" />
    ) : (
      renderLineContent(text, wrap, highlight)
    );

  return (
    <div
      ref={measureRef}
      data-component={LOG_ROW_NAME}
      data-index={index}
      data-line={index + 1}
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
  total,
  size,
  wrap,
  follow,
  onUserScrollAway,
  highlight = null,
  className,
}: LogViewerProps): ReactElement => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef(file);
  const totalRef = useRef(total);
  const sizeRef = useRef(size);
  const followRef = useRef(follow);
  const scrollAwayRef = useRef(onUserScrollAway);
  const rowsRef = useRef<HTMLDivElement>(null);
  const programmaticRef = useRef(0);

  fileRef.current = file;
  totalRef.current = total;
  sizeRef.current = size;
  followRef.current = follow;
  scrollAwayRef.current = onUserScrollAway;

  const cache = useMemo<LineCache>(
    () =>
      createLineCache({
        fetchChunk: ({ from, count, signal }) =>
          fetchLogLines(fileRef.current, from, count, signal),
      }),
    [],
  );

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
      holdProgrammatic();
      virtualizerRef.current.scrollToIndex(index, { align });
    },
    [holdProgrammatic],
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

  const handleScroll = useCallback(() => {
    if (programmaticRef.current > 0) return;
    if (!followRef.current) return;
    const element = scrollRef.current;
    if (element === null) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distance > BOTTOM_THRESHOLD_PX) scrollAwayRef.current();
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
      reload: () => {
        cache.reset();
        cache.setTotal(totalRef.current, sizeRef.current);
      },
    }),
    [cache, getVisibleRange, scrollToLine],
  );

  useEffect(() => cache.destroy, [cache]);

  // ? File switch: everything cached, measured and sized belongs to the old file.
  useEffect(() => {
    cache.reset();
    cache.setTotal(totalRef.current, sizeRef.current);
    setMinWidth(0);
    virtualizerRef.current.measure();
    holdProgrammatic();
    if (scrollRef.current !== null) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
  }, [cache, file, holdProgrammatic]);

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
    if (!follow || total === 0) return;
    scrollToLine(total - 1, 'end');
  }, [follow, total, scrollToLine]);

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
      className={containerClass}
    >
      <div
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
