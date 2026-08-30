import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { type TFunction } from 'i18next';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Filter,
  Play,
  Regex,
  RefreshCw,
  ScrollText,
  TextWrap,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import type { LineAlign, LogViewerHandle } from '../components/log-viewer/log-viewer';
import type {
  LogLevel,
  LogLevelCounts,
  LogSearchDirection,
  LogWindow,
  LogWindowMinutes,
  MatchSplit,
  SearchCriteria,
} from '../lib/api/logs';
import type { ApiError } from '../types/api';

import { LEVEL_EMPHASIS, LEVEL_TOKEN_CLASS } from '../components/log-viewer/log-line';
import { LogViewer } from '../components/log-viewer/log-viewer';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { toast } from '../components/ui/sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import {
  LOG_LEVELS,
  LOG_WINDOWS,
  fetchLogWindow,
  levelsParam,
  locateLogLine,
  logDownloadUrl,
  logFilesQueryOptions,
  logInfoQueryOptions,
  logMatchesQueryOptions,
  matchSplit,
  searchLog,
} from '../lib/api/logs';
import { cn } from '../lib/utils';

const LOGS_PAGE_NAME = 'LogsPage';

// ? Following a live file needs a tight poll; a live file being read somewhere other than its
// ? tail does not. A rotated file is polled at neither rate — see `infoPoll` below.
const FOLLOW_POLL_MS = 1000;
const IDLE_POLL_MS = 5000;

const GOTO_PATTERN = /^\d+$/;

// ? Line 0 with no time is what the API reports when a window cuts nothing, so the "whole file"
// ? state and a window that turned out to cover it are the same value rather than two.
const NO_CUT: LogWindow = { line: 0, time: null };

// ? The label wants the hour and minute the cut landed on, not the seconds the log records.
const CUT_LABEL_LENGTH = 5;

// ? Beyond two names the trigger reads as a list rather than a label; show a count instead.
const MAX_NAMED_LEVELS = 2;

const WINDOW_LABEL_KEYS: Record<LogWindowMinutes, string> = {
  15: 'logs.window.minutes15',
  30: 'logs.window.minutes30',
  60: 'logs.window.hours1',
  360: 'logs.window.hours6',
};

const LEVEL_COUNT_KEYS: Record<LogLevel, keyof LogLevelCounts> = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};

const searchSchema = z.object({
  file: z.string().optional(),
});

/**
 * Where the next search resumes. `line` is a physical line number; `position` is the row the view
 * scrolled to for it, which is the only thing comparable against the viewport when the filter
 * hides `line` itself, and `null` until the locate that resolves it lands. `inclusive` keeps
 * `line` a candidate.
 */
type SearchCursor = { line: number; position: number | null; inclusive: boolean };

/**
 * The single occupant of the badge slot. `hit` carries a physical line and, once the count has
 * reached it, its position among the matches the active filter admits; `hidden` is the other way
 * a jump ends, a goto whose target the filter does not show.
 */
type VerdictState =
  | { kind: 'none' }
  | { kind: 'noMatch' }
  | { kind: 'error'; message: string }
  | { kind: 'hit'; line: number; ordinal: number | null }
  | { kind: 'hidden'; line: number };

function formatSize(bytes: number): string {
  if (bytes < 0) return '—';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;

  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTimestamp(value: string | undefined): string {
  if (value == null || value === '') return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isApiError(error: unknown): error is ApiError {
  return typeof error === 'object' && error != null && 'status' in error && 'message' in error;
}

/**
 * How a hit reads: its ordinal into the whole-file count, the matches the filter is holding back,
 * and the line number alone until the count has scanned far enough to place it.
 *
 * A running count says `3 of 147…`, because the total is a floor rather than an answer — flat, it
 * would tell the reader a query was exhausted when nobody has finished looking.
 */
function hitLabel(
  t: TFunction,
  line: number,
  ordinal: number | null,
  split: MatchSplit | null,
  complete: boolean,
): string {
  if (ordinal == null || split == null) {
    return t('logs.search.matchAt', { line: (line + 1).toLocaleString() });
  }

  // ! The ordinal comes from the search response and the split from the count query, which are
  // ! separate requests. While the count is still running the split can lag behind the hit the
  // ! search already placed, and an unclamped total would read as "5 of 3".
  const total = Math.max(split.visible, ordinal + 1);
  const key = complete ? 'logs.search.matchOrdinal' : 'logs.search.matchOrdinalPartial';
  const counted = t(key, {
    ordinal: (ordinal + 1).toLocaleString(),
    total: total.toLocaleString(),
  });

  if (split.hidden === 0) return counted;
  return `${counted} ${t('logs.search.matchesHidden', { hidden: split.hidden.toLocaleString() })}`;
}

//
// * IconAction
//

type IconActionProps = {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
};

const ICON_ACTION_NAME = 'IconAction';

const IconAction = ({
  label,
  onClick,
  children,
  active = false,
  disabled = false,
}: IconActionProps): ReactElement => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-component={ICON_ACTION_NAME}
          variant={active ? 'primary' : 'ghost'}
          size="icon"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

IconAction.displayName = ICON_ACTION_NAME;

//
// * LogsPage
//

const LogsPage = (): ReactElement => {
  const viewerRef = useRef<LogViewerHandle>(null);
  const cursorRef = useRef<SearchCursor | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const locateAbortRef = useRef<AbortController | null>(null);
  const cutAbortRef = useRef<AbortController | null>(null);
  // ? Last file size seen, to tell an append from the rotation that invalidates a cut.
  const sizeSeenRef = useRef<number | null>(null);
  const searchingRef = useRef(false);
  // ? Physical line to return to once a filter change has re-indexed the view.
  const anchorRef = useRef<number | null>(null);
  // ? Last physical line the viewport was known to be at, for when it can no longer say.
  const originRef = useRef<number | null>(null);

  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const { file: fileParam } = Route.useSearch();

  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [query, setQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [verdict, setVerdict] = useState<VerdictState>({ kind: 'none' });
  // ? What the count is for. Set when a search runs, never while typing: a count reads the whole
  // ? file, so it follows the criteria a reader committed to rather than every keystroke.
  const [counted, setCounted] = useState<SearchCriteria | null>(null);
  const [searching, setSearching] = useState(false);
  const [gotoValue, setGotoValue] = useState('');
  const [levels, setLevels] = useState<LogLevel[]>([...LOG_LEVELS]);
  // ? A cut, not a rolling window: the line is resolved once against the file's last entry and
  // ? then held, so the view grows at its end as the file does instead of sliding off its front.
  const [cut, setCut] = useState<LogWindow>(NO_CUT);

  // ? Read by the search when it runs off an edge, which is a decision about the hit already
  // ? standing rather than about the criteria the callback closed over.
  const verdictRef = useRef(verdict);
  verdictRef.current = verdict;

  const levelsKey = levelsParam(levels) ?? '';
  const filtering = levelsKey !== '';
  const levelsRef = useRef(levels);
  levelsRef.current = levels;

  const start = cut.line;
  // ? What a change of view has to invalidate: both narrow the rows, and a position means
  // ? something different on either side of either one.
  const viewKey = `${levelsKey}\u0000${start}`;
  const startRef = useRef(start);
  startRef.current = start;

  const { data: files = [] } = useQuery(logFilesQueryOptions(IDLE_POLL_MS));

  const selected = useMemo(() => {
    if (fileParam != null && files.some((entry) => entry.name === fileParam)) return fileParam;
    return (files.find((entry) => entry.active) ?? files[0])?.name;
  }, [fileParam, files]);

  const selectedFile = useMemo(
    () => files.find((entry) => entry.name === selected),
    [files, selected],
  );

  // ? Nothing can be appended to a rotated file, so following it is a promise no poll can keep.
  // ? Every *read* of the follow state goes through `following`, which masks the `true` the
  // ? setters still leave underneath — that is what keeps a scroll to the end from re-arming a
  // ? follow that cannot fire, while switching back to a live file resumes following as before.
  const rotated = selectedFile?.rotated ?? false;
  const following = follow && !rotated;

  // ? A frozen file has no size, count or timestamp left to discover; Refresh and
  // ? refetch-on-focus still re-read it, and the file-list poll still catches its deletion.
  let infoPoll: number | false = IDLE_POLL_MS;
  if (rotated) infoPoll = false;
  else if (following) infoPoll = FOLLOW_POLL_MS;

  const { data: info, error: infoError } = useQuery(
    logInfoQueryOptions(selected, levels, start, infoPoll),
  );

  // ? Keyed without the levels, mirroring the server: the scan counts physical lines, and a
  // ? filter is a sum over the per-level split it returns. Toggling a level then costs nothing.
  const { data: matches } = useQuery(logMatchesQueryOptions(selected, counted, start));

  const split = useMemo(
    () => (matches == null ? null : matchSplit(matches.levels, levels)),
    [levels, matches],
  );

  const highlight = useMemo(() => {
    if (query === '') return null;
    try {
      return new RegExp(useRegex ? query : escapeRegExp(query), caseSensitive ? 'g' : 'gi');
    } catch {
      return null;
    }
  }, [query, useRegex, caseSensitive]);

  // ? Rows the viewer addresses, which a filter decouples from the file's own line count. The
  // ? search and goto controls speak physical lines, so both numbers are needed.
  const total = info?.filtered ?? info?.lines ?? 0;
  const lineTotal = info?.lines ?? 0;
  const size = info?.size ?? selectedFile?.size ?? 0;
  const modified = info?.modified ?? selectedFile?.modified;

  const handleSelectFile = useCallback(
    (name: string) => {
      void navigate({ search: { file: name }, replace: true });
    },
    [navigate],
  );

  /**
   * Physical lines the viewport currently covers. Row indices are positions in the filtered
   * view, while every cursor, search hit and goto target is a physical line number.
   */
  const visiblePhysicalRange = useCallback((): { first: number; last: number } | null => {
    const viewer = viewerRef.current;
    const range = viewer?.getVisibleRange() ?? null;
    if (viewer == null || range == null) return null;

    const first = viewer.getPhysicalLine(range.first);
    const last = viewer.getPhysicalLine(range.last);
    // ! A filtered row whose chunk has not landed has no physical number, and its index is not
    // ! one — under a filter the two are thousands of lines apart. Report nothing over a guess.
    if (first == null || last == null) return null;

    return { first, last };
  }, []);

  /** Begin a locate request, superseding whichever one is still in flight. */
  const startLocate = useCallback((): AbortController => {
    locateAbortRef.current?.abort();
    const controller = new AbortController();
    locateAbortRef.current = controller;
    return controller;
  }, []);

  /**
   * Put a physical line on screen, following it through the filter when one is active, and record
   * it as the cursor the next search steps off.
   */
  const revealLine = useCallback(
    (line: number, align: LineAlign, inclusive: boolean) => {
      if (selected == null) return;

      originRef.current = line;

      // ? Without a filter a position is the line minus the cut, which the client can do
      // ? itself — the round trip is only needed when the filter decides what a row holds.
      if (!filtering) {
        locateAbortRef.current?.abort();
        locateAbortRef.current = null;
        const position = Math.max(0, line - startRef.current);
        cursorRef.current = { line, position, inclusive };
        viewerRef.current?.scrollToLine(position, align);
        return;
      }

      const controller = startLocate();
      // ? Unresolved until the locate lands, which is what keeps a second click before then
      // ? stepping off `line` rather than restarting from the viewport.
      cursorRef.current = { line, position: null, inclusive };

      locateLogLine(selected, line, levelsRef.current, startRef.current, controller.signal)
        .then((location) => {
          if (controller.signal.aborted) return;
          // ? Only a jump that claimed nothing can become a "hidden" verdict. A search hit is
          // ? always a line the filter admits, so a locate cannot overturn one.
          if (!location.visible) {
            setVerdict((prev) => (prev.kind === 'none' ? { kind: 'hidden', line } : prev));
          }
          // ! The row the view actually reached, not the line — a hidden hit sits at no row of
          // ! its own, and comparing the line against the viewport would discard the cursor and
          // ! hand back the same hit for ever.
          if (cursorRef.current?.line === line) {
            cursorRef.current = { line, position: location.position, inclusive };
          }
          viewerRef.current?.scrollToLine(location.position, align);
        })
        .catch(() => {
          // ? Best effort: a lost position leaves the view usable, just not repositioned.
        });
    },
    [filtering, selected, startLocate],
  );

  /**
   * How a search that reached an edge ends. Every verdict is discarded when the criteria, the
   * filter or the file change, so a hit still standing is one of *these* matches: the reader is
   * at the last or first of them, and stepping past it holds there rather than reporting the
   * query dry. Only a search that never placed a hit has nothing to match.
   */
  const settleExhausted = useCallback(() => {
    const current = verdictRef.current;
    if (current.kind !== 'hit') {
      setVerdict({ kind: 'noMatch' });
      return;
    }
    // ? Re-revealed rather than left alone: the reader may have scrolled away, and a badge
    // ? asserting a match off screen is the same lie as a wrong count.
    revealLine(current.line, 'center', false);
  }, [revealLine]);

  const runSearch = useCallback(
    (direction: LogSearchDirection) => {
      if (selected == null || query === '' || searchingRef.current) return;

      // ? Running a search is what commits the reader to these criteria, and the only thing that
      // ? starts a whole-file count of them.
      setCounted({ query, regex: useRegex, caseSensitive });

      // ? Stepping off the last match only makes sense while it is still on screen; once the
      // ? user has scrolled away, the viewport is the anchor. The test is in row space because
      // ? that is where the viewport is measured, and a hidden hit has no row of its own. A
      // ? cursor whose row is not resolved yet has not been scrolled away from either.
      const rows = viewerRef.current?.getVisibleRange() ?? null;
      const range = visiblePhysicalRange();
      if (range != null) originRef.current = range.first;

      const cursor = cursorRef.current;
      const onScreen =
        rows == null ||
        cursor?.position == null ||
        (cursor.position >= rows.first && cursor.position <= rows.last);
      const anchor = cursor != null && onScreen ? cursor : null;

      // ? `visiblePhysicalRange` comes back empty for two different reasons, and only one of
      // ? them warrants a remembered origin: rows on screen whose numbers have not arrived. No
      // ? rows at all means there is no reader position to preserve.
      const forward = direction === 'forward';
      const edge = forward ? start : lineTotal - 1;
      const viewport = forward ? range?.first : range?.last;
      const unnumbered = rows != null ? originRef.current : null;
      const fromViewport = viewport ?? unnumbered ?? edge;
      const step = forward ? 1 : -1;
      const from = anchor != null ? anchor.line + (anchor.inclusive ? 0 : step) : fromViewport;

      if (from < start || from >= lineTotal) {
        settleExhausted();
        return;
      }

      const controller = new AbortController();
      searchAbortRef.current = controller;
      searchingRef.current = true;
      setSearching(true);

      searchLog({
        file: selected,
        query,
        from,
        direction,
        levels: levelsRef.current,
        start,
        regex: useRegex,
        caseSensitive,
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.line == null) {
            settleExhausted();
            return;
          }
          setVerdict({ kind: 'hit', line: result.line, ordinal: result.ordinal });
          setFollow(false);
          revealLine(result.line, 'center', false);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setVerdict({
            kind: 'error',
            message:
              isApiError(cause) && cause.message !== ''
                ? cause.message
                : t('common.error.unexpected'),
          });
        })
        .finally(() => {
          if (searchAbortRef.current !== controller) return;
          searchAbortRef.current = null;
          searchingRef.current = false;
          setSearching(false);
        });
    },
    [
      caseSensitive,
      lineTotal,
      query,
      revealLine,
      selected,
      settleExhausted,
      start,
      t,
      useRegex,
      visiblePhysicalRange,
    ],
  );

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runSearch(event.shiftKey ? 'backward' : 'forward');
    },
    [runSearch],
  );

  const clearSearchVerdict = useCallback(() => {
    setVerdict({ kind: 'none' });
  }, []);

  const handleGoto = useCallback(() => {
    if (!GOTO_PATTERN.test(gotoValue) || lineTotal === 0) return;
    const requested = Math.min(Math.max(0, Number.parseInt(gotoValue, 10) - 1), lineTotal - 1);
    const line = Math.max(start, requested);
    clearSearchVerdict();
    setFollow(false);
    // ? The window is the one thing that hides a line without the filter having an opinion, so
    // ? it is the one case `revealLine` cannot discover from a locate it never sends.
    if (requested < start) setVerdict({ kind: 'hidden', line: requested });
    // ? The jump centres the line, so the viewport reaches back above it and forward below it;
    // ? the next search has to resume from the line itself, hence the inclusive cursor.
    revealLine(line, 'center', true);
  }, [clearSearchVerdict, gotoValue, lineTotal, revealLine, start]);

  // ? Captured before a filter change: once the view re-indexes, the row the reader was on is
  // ? gone and only its physical line number can find the way back.
  const captureAnchor = useCallback(() => {
    if (following) {
      anchorRef.current = null;
      return;
    }
    // ! The menu stays open across several toggles, and between them the view has neither a
    // ! count nor line numbers to read a fresh anchor from. Keep the anchor still pending, and
    // ! failing that the last position the viewport actually resolved to — the restore consumes
    // ! the anchor as soon as the count lands, well before the lines do.
    if (anchorRef.current != null) return;
    anchorRef.current = visiblePhysicalRange()?.first ?? originRef.current;
  }, [following, visiblePhysicalRange]);

  const handleToggleLevel = useCallback(
    (level: LogLevel) => {
      captureAnchor();
      setLevels((prev) =>
        prev.includes(level) ? prev.filter((entry) => entry !== level) : [...prev, level],
      );
    },
    [captureAnchor],
  );

  const handleClearLevels = useCallback(() => {
    captureAnchor();
    setLevels([...LOG_LEVELS]);
  }, [captureAnchor]);

  /**
   * Resolves a preset into the line it cuts at and holds that. Re-picking the preset already in
   * effect is how the cut is moved to now — there is no other way to ask for it, and after any
   * time has passed it is a different line.
   */
  const handleCut = useCallback(
    (minutes: number) => {
      if (selected == null) return;

      cutAbortRef.current?.abort();
      const controller = new AbortController();
      cutAbortRef.current = controller;

      fetchLogWindow(selected, minutes, controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return;
          if (next.line === 0) toast.info(t('logs.toast.windowCoversFile'));
          // ? Only for a cut that actually moves. The anchor is consumed by the effect watching
          // ? the view, so capturing one when nothing changed leaves it pending until a later
          // ? growth poll spends it, yanking the viewport back to where the reader used to be.
          if (next.line === startRef.current) return;
          captureAnchor();
          setCut(next);
        })
        .catch(() => {
          // ? Best effort: a window that could not be resolved leaves the view as it was.
        });
    },
    [captureAnchor, selected, t],
  );

  const handleClearCut = useCallback(() => {
    cutAbortRef.current?.abort();
    cutAbortRef.current = null;
    captureAnchor();
    setCut(NO_CUT);
  }, [captureAnchor]);

  const handleTop = useCallback(() => {
    clearSearchVerdict();
    setFollow(false);
    cursorRef.current = null;
    viewerRef.current?.scrollToLine(0, 'start');
  }, [clearSearchVerdict]);

  const handleBottom = useCallback(() => {
    if (total === 0) return;
    clearSearchVerdict();
    cursorRef.current = null;
    setFollow(true);
    viewerRef.current?.scrollToLine(total - 1, 'end');
  }, [clearSearchVerdict, total]);

  const handleRefresh = useCallback(() => {
    viewerRef.current?.reload();
    void queryClient.invalidateQueries({ queryKey: ['logs'] });
  }, [queryClient]);

  // ? A newly opened file lands at its end, so it starts out followed — the
  // ? viewer's own scroll report is too late to be relied on for that.
  useEffect(() => {
    cursorRef.current = null;
    anchorRef.current = null;
    originRef.current = null;
    setFollow(true);
    setVerdict({ kind: 'none' });
    // ? A cut is a line number of the file it was taken from, so it cannot survive into another.
    cutAbortRef.current?.abort();
    setCut(NO_CUT);
    return () => {
      searchAbortRef.current?.abort();
      locateAbortRef.current?.abort();
      cutAbortRef.current?.abort();
    };
  }, [selected]);

  // ! Every verdict here was decided against a filter no longer in effect, a hit's ordinal
  // ! included: it counts the matches one mask admits, so pairing it with a split re-derived
  // ! from another reports two views as one number. The count itself is keyed without levels
  // ! and survives. The search is aborted too, not just the locate — it is scoped to the levels
  // ! it was sent with, so a hit still in flight would land on a line this filter hides.
  useEffect(() => {
    locateAbortRef.current?.abort();
    locateAbortRef.current = null;
    searchAbortRef.current?.abort();
    setVerdict({ kind: 'none' });
  }, [viewKey]);

  // ? Runs once the re-indexed count has landed, which is the first moment a position in the
  // ? new view means anything. `total` is the trigger for exactly that reason.
  // ! No cleanup abort: this effect re-runs on every growth poll, and tearing down its own
  // ! request there would lose the restore, since the anchor is already consumed.
  useEffect(() => {
    const anchor = anchorRef.current;
    if (anchor == null || selected == null || total === 0) return;
    anchorRef.current = null;
    originRef.current = anchor;

    const controller = startLocate();

    locateLogLine(selected, anchor, levelsRef.current, startRef.current, controller.signal)
      .then((location) => {
        if (controller.signal.aborted) return;
        setFollow(false);
        viewerRef.current?.scrollToLine(location.position, 'start');
      })
      .catch(() => {
        // ? Best effort: a lost anchor leaves the view usable, just repositioned.
      });
  }, [selected, startLocate, total, viewKey]);

  // ! Rotation replaces a file's contents without changing its name, so `selected` never moves
  // ! and the effect above never fires — but the held line now points into a log that is gone.
  // ! Left alone it renders an empty view the reader has no way to read as stale.
  useEffect(() => {
    const size = info?.size;
    if (size == null) return;
    const previous = sizeSeenRef.current;
    sizeSeenRef.current = size;
    if (previous != null && size < previous) setCut(NO_CUT);
  }, [info?.size]);

  // ? A match cursor holds a hit of the previous criteria, so it cannot be
  // ? stepped off once the criteria change; a goto cursor is criteria-agnostic
  // ? and survives. A request still in flight would reinstate the match cursor
  // ? when it lands, so it goes too, along with the verdict the badges are
  // ? still asserting for criteria no longer in effect.
  useEffect(() => {
    if (cursorRef.current?.inclusive === false) cursorRef.current = null;
    searchAbortRef.current?.abort();
    setVerdict({ kind: 'none' });
  }, [query, useRegex, caseSensitive]);

  if (files.length === 0) {
    return (
      <div data-component={LOGS_PAGE_NAME} className="flex h-full flex-col">
        <EmptyState
          icon={ScrollText}
          title={t('logs.empty.title')}
          description={t('logs.empty.description')}
        />
      </div>
    );
  }

  let searchVerdict: ReactNode = null;
  if (verdict.kind === 'error') {
    searchVerdict = (
      <Badge variant="destructive" className="max-w-[16rem] shrink-0 truncate">
        {verdict.message}
      </Badge>
    );
  } else if (verdict.kind === 'noMatch') {
    searchVerdict = (
      <Badge variant="destructive" className="shrink-0">
        {t('logs.search.noMatch')}
      </Badge>
    );
  } else if (verdict.kind === 'hit') {
    searchVerdict = (
      <Badge variant="outline" className="shrink-0 whitespace-nowrap">
        {hitLabel(t, verdict.line, verdict.ordinal, split, matches?.complete ?? false)}
      </Badge>
    );
  } else if (verdict.kind === 'hidden') {
    searchVerdict = (
      <Badge variant="outline" className="shrink-0 whitespace-nowrap">
        {t('logs.filter.lineHidden', { line: (verdict.line + 1).toLocaleString() })}
      </Badge>
    );
  }

  const selectedLevels = LOG_LEVELS.filter((level) => levels.includes(level));
  let filterLabel = t('logs.filter.all');
  if (filtering && selectedLevels.length > MAX_NAMED_LEVELS) {
    filterLabel = t('logs.filter.selected', {
      count: selectedLevels.length,
      total: LOG_LEVELS.length,
    });
  } else if (filtering) {
    filterLabel = selectedLevels.join(', ');
  }

  const downloadLabel = start > 0 ? t('logs.action.downloadCut') : t('logs.action.download');

  let cutLabel = t('logs.window.all');
  if (cut.time != null) {
    cutLabel = t('logs.window.since', { time: cut.time.slice(0, CUT_LABEL_LENGTH) });
  }

  // ? The status counts the rows on screen against the file's own total, so it answers to both
  // ? things that narrow the view — `filtering` alone speaks only for the level menu.
  const lineStatus =
    filtering || start > 0
      ? t('logs.status.linesFiltered', {
          filtered: total.toLocaleString(),
          total: lineTotal.toLocaleString(),
        })
      : t('logs.status.lines', { total: lineTotal.toLocaleString() });

  let viewer: ReactNode;
  if (selected == null) {
    viewer = (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        {t('logs.viewer.selectFile')}
      </div>
    );
  } else if (infoError != null) {
    viewer = (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={ScrollText}
          title={t('logs.error.infoFailed')}
          description={
            isApiError(infoError) && infoError.message !== ''
              ? infoError.message
              : t('common.error.unexpected')
          }
        />
      </div>
    );
  } else {
    viewer = (
      <LogViewer
        ref={viewerRef}
        className="min-h-0 flex-1"
        file={selected}
        levels={levels}
        start={start}
        total={total}
        size={info?.size ?? 0}
        wrap={wrap}
        highlight={highlight}
        follow={following}
        onAtBottomChange={setFollow}
      />
    );
  }

  return (
    <div data-component={LOGS_PAGE_NAME} className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-border bg-card flex shrink-0 flex-col gap-2 border-b px-4 py-2">
        {/* File and view actions */}
        <div className="flex items-center gap-2">
          <Select value={selected ?? ''} onValueChange={handleSelectFile}>
            <SelectTrigger
              className="h-8 w-[20rem] font-mono text-xs"
              aria-label={t('logs.field.selectFile')}
            >
              <SelectValue placeholder={t('logs.field.selectFile')} />
            </SelectTrigger>
            <SelectContent>
              {files.map((entry) => (
                <SelectItem key={entry.name} value={entry.name} className="font-mono text-xs">
                  {entry.name} · {formatSize(entry.size)}
                  {entry.active ? ` · ${t('logs.badge.active')}` : ''}
                  {entry.rotated ? ` · ${t('logs.badge.rotated')}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" asChild>
                <a
                  href={selected == null ? undefined : logDownloadUrl(selected, start)}
                  aria-label={downloadLabel}
                  // ? Empty rather than the file name: a windowed download is a different file,
                  // ? and the server has already named it in `Content-Disposition`.
                  download=""
                >
                  <Download className="size-4" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{downloadLabel}</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant={filtering ? 'primary' : 'ghost'}
                aria-label={t('logs.filter.label')}
              >
                <Filter className="size-4" />
                {filterLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>{t('logs.filter.label')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {LOG_LEVELS.map((level) => (
                <DropdownMenuCheckboxItem
                  key={level}
                  checked={levels.includes(level)}
                  // ? Toggling one level should not close a menu the reader is still using.
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => handleToggleLevel(level)}
                >
                  <span
                    className={cn('font-mono text-xs', LEVEL_TOKEN_CLASS[level], LEVEL_EMPHASIS)}
                  >
                    {level}
                  </span>
                  <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                    {(info?.levels[LEVEL_COUNT_KEYS[level]] ?? 0).toLocaleString()}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!filtering} onSelect={handleClearLevels}>
                {t('logs.filter.clear')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant={start > 0 ? 'primary' : 'ghost'}
                disabled={selected == null}
                aria-label={t('logs.window.label')}
              >
                <Clock className="size-4" />
                {cutLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>{t('logs.window.label')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {LOG_WINDOWS.map((minutes) => (
                <DropdownMenuItem key={minutes} onSelect={() => handleCut(minutes)}>
                  {t(WINDOW_LABEL_KEYS[minutes])}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={start === 0} onSelect={handleClearCut}>
                {t('logs.window.all')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant={following ? 'primary' : 'ghost'}
              aria-pressed={following}
              disabled={rotated}
              onClick={() => setFollow((prev) => !prev)}
            >
              <Play className="size-4" />
              {t('logs.action.follow')}
            </Button>

            <Button
              size="sm"
              variant={wrap ? 'primary' : 'ghost'}
              aria-pressed={wrap}
              onClick={() => setWrap((prev) => !prev)}
            >
              <TextWrap className="size-4" />
              {t('logs.action.wrap')}
            </Button>

            <IconAction label={t('common.action.refresh')} onClick={handleRefresh}>
              <RefreshCw className="size-4" />
            </IconAction>
          </div>
        </div>

        {/* Search and navigation */}
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('logs.field.searchPlaceholder')}
            aria-label={t('logs.field.search')}
            className="h-8 min-w-0 flex-1 font-mono text-xs"
          />
          <IconAction
            label={t('logs.search.regex')}
            active={useRegex}
            onClick={() => setUseRegex((prev) => !prev)}
          >
            <Regex className="size-4" />
          </IconAction>
          <IconAction
            label={t('logs.search.caseSensitive')}
            active={caseSensitive}
            onClick={() => setCaseSensitive((prev) => !prev)}
          >
            <CaseSensitive className="size-4" />
          </IconAction>
          {searchVerdict}
          <IconAction
            label={t('logs.action.previousMatch')}
            disabled={searching || query === ''}
            onClick={() => runSearch('backward')}
          >
            <ChevronUp className="size-4" />
          </IconAction>
          <IconAction
            label={t('logs.action.nextMatch')}
            disabled={searching || query === ''}
            onClick={() => runSearch('forward')}
          >
            <ChevronDown className="size-4" />
          </IconAction>

          <div className="bg-border mx-1 h-5 w-px" />

          <Input
            value={gotoValue}
            onChange={(event) => setGotoValue(event.target.value.replace(/\D/g, ''))}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              handleGoto();
            }}
            inputMode="numeric"
            placeholder={t('logs.field.goToLinePlaceholder')}
            aria-label={t('logs.field.goToLine')}
            className="h-8 w-[7rem] font-mono text-xs"
          />
          <Button size="sm" variant="ghost" onClick={handleGoto} disabled={gotoValue === ''}>
            {t('logs.action.goToLine')}
          </Button>

          <IconAction label={t('logs.action.top')} onClick={handleTop}>
            <ArrowUpToLine className="size-4" />
          </IconAction>
          <IconAction label={t('logs.action.bottom')} onClick={handleBottom}>
            <ArrowDownToLine className="size-4" />
          </IconAction>
        </div>
      </div>

      {/* Viewer */}
      {viewer}

      {/* Status footer */}
      <div className="border-border bg-card text-muted-foreground flex h-7 shrink-0 items-center gap-4 border-t px-4 text-xs">
        <span className="font-mono">{selected ?? '—'}</span>
        <span>{lineStatus}</span>
        <span>{t('logs.status.size', { size: formatSize(size) })}</span>
        <span>{t('logs.status.modified', { modified: formatTimestamp(modified) })}</span>
        {rotated && <Badge variant="outline">{t('logs.badge.rotated')}</Badge>}
        {following && <Badge variant="outline">{t('logs.status.following')}</Badge>}
      </div>
    </div>
  );
};

LogsPage.displayName = LOGS_PAGE_NAME;

//
// * LogsError
//

const LOGS_ERROR_NAME = 'LogsError';

const LogsError = ({ error }: ErrorComponentProps): ReactElement => {
  const { t } = useTranslation();
  const message = error instanceof Error ? error.message : t('common.error.unexpected');

  return (
    <div data-component={LOGS_ERROR_NAME} className="flex flex-col gap-4 p-4">
      <EmptyState icon={ScrollText} title={t('logs.error.loadFailed')} description={message} />
    </div>
  );
};

LogsError.displayName = LOGS_ERROR_NAME;

export const Route = createFileRoute('/logs')({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(logFilesQueryOptions()),
  component: LogsPage,
  errorComponent: LogsError,
});
