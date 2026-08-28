import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
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
import type { LogLevel, LogLevelCounts, LogSearchDirection } from '../lib/api/logs';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import {
  LOG_LEVELS,
  levelsParam,
  locateLogLine,
  logDownloadUrl,
  logFilesQueryOptions,
  logInfoQueryOptions,
  searchLog,
} from '../lib/api/logs';
import { cn } from '../lib/utils';

const LOGS_PAGE_NAME = 'LogsPage';

// ? Following a live file needs a tight poll; a live file being read somewhere other than its
// ? tail does not. A rotated file is polled at neither rate — see `infoPoll` below.
const FOLLOW_POLL_MS = 1000;
const IDLE_POLL_MS = 5000;

const GOTO_PATTERN = /^\d+$/;

// ? Beyond two names the trigger reads as a list rather than a label; show a count instead.
const MAX_NAMED_LEVELS = 2;

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
  const [noMatch, setNoMatch] = useState(false);
  const [matchLine, setMatchLine] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [gotoValue, setGotoValue] = useState('');
  const [levels, setLevels] = useState<LogLevel[]>([...LOG_LEVELS]);
  const [hiddenLine, setHiddenLine] = useState<number | null>(null);

  const levelsKey = levelsParam(levels) ?? '';
  const filtering = levelsKey !== '';
  const levelsRef = useRef(levels);
  levelsRef.current = levels;

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
    logInfoQueryOptions(selected, levels, infoPoll),
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

      if (!filtering) {
        locateAbortRef.current?.abort();
        locateAbortRef.current = null;
        setHiddenLine(null);
        cursorRef.current = { line, position: line, inclusive };
        viewerRef.current?.scrollToLine(line, align);
        return;
      }

      const controller = startLocate();
      // ? Unresolved until the locate lands, which is what keeps a second click before then
      // ? stepping off `line` rather than restarting from the viewport.
      cursorRef.current = { line, position: null, inclusive };

      locateLogLine(selected, line, levelsRef.current, controller.signal)
        .then((location) => {
          if (controller.signal.aborted) return;
          setHiddenLine(location.visible ? null : line);
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

  const runSearch = useCallback(
    (direction: LogSearchDirection) => {
      if (selected == null || query === '' || searchingRef.current) return;

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
      const edge = forward ? 0 : lineTotal - 1;
      const viewport = forward ? range?.first : range?.last;
      const unnumbered = rows != null ? originRef.current : null;
      const fromViewport = viewport ?? unnumbered ?? edge;
      const step = forward ? 1 : -1;
      const from = anchor != null ? anchor.line + (anchor.inclusive ? 0 : step) : fromViewport;

      setSearchError(null);

      if (from < 0 || from >= lineTotal) {
        setNoMatch(true);
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
        regex: useRegex,
        caseSensitive,
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.line == null) {
            setNoMatch(true);
            return;
          }
          setNoMatch(false);
          setMatchLine(result.line);
          setFollow(false);
          revealLine(result.line, 'center', false);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setNoMatch(false);
          setSearchError(
            isApiError(cause) && cause.message !== ''
              ? cause.message
              : t('common.error.unexpected'),
          );
        })
        .finally(() => {
          if (searchAbortRef.current !== controller) return;
          searchAbortRef.current = null;
          searchingRef.current = false;
          setSearching(false);
        });
    },
    [caseSensitive, lineTotal, query, revealLine, selected, t, useRegex, visiblePhysicalRange],
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
    setNoMatch(false);
    setMatchLine(null);
    setSearchError(null);
    setHiddenLine(null);
  }, []);

  const handleGoto = useCallback(() => {
    if (!GOTO_PATTERN.test(gotoValue) || lineTotal === 0) return;
    const line = Math.max(0, Math.min(Number.parseInt(gotoValue, 10) - 1, lineTotal - 1));
    clearSearchVerdict();
    setFollow(false);
    // ? The jump centres the line, so the viewport reaches back above it and forward below it;
    // ? the next search has to resume from the line itself, hence the inclusive cursor.
    revealLine(line, 'center', true);
  }, [clearSearchVerdict, gotoValue, lineTotal, revealLine]);

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
    setNoMatch(false);
    setMatchLine(null);
    setSearchError(null);
    setHiddenLine(null);
    return () => {
      searchAbortRef.current?.abort();
      locateAbortRef.current?.abort();
    };
  }, [selected]);

  // ? A level change invalidates both verdicts for the same reason a criteria change invalidates
  // ? a match cursor: they were decided against a filter no longer in effect. Dropping only the
  // ? hidden half would turn "hidden by the filter" into an unchecked claim that the line is on
  // ? screen, and a locate still in flight would reinstate the stale verdict it replaced.
  useEffect(() => {
    locateAbortRef.current?.abort();
    locateAbortRef.current = null;
    setHiddenLine(null);
    setMatchLine(null);
  }, [levelsKey]);

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

    locateLogLine(selected, anchor, levelsRef.current, controller.signal)
      .then((location) => {
        if (controller.signal.aborted) return;
        setFollow(false);
        viewerRef.current?.scrollToLine(location.position, 'start');
      })
      .catch(() => {
        // ? Best effort: a lost anchor leaves the view usable, just repositioned.
      });
  }, [levelsKey, selected, startLocate, total]);

  // ? A match cursor holds a hit of the previous criteria, so it cannot be
  // ? stepped off once the criteria change; a goto cursor is criteria-agnostic
  // ? and survives. A request still in flight would reinstate the match cursor
  // ? when it lands, so it goes too, along with the verdict the badges are
  // ? still asserting for criteria no longer in effect.
  useEffect(() => {
    if (cursorRef.current?.inclusive === false) cursorRef.current = null;
    searchAbortRef.current?.abort();
    setNoMatch(false);
    setMatchLine(null);
    setSearchError(null);
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
  if (searchError != null) {
    searchVerdict = (
      <Badge variant="destructive" className="max-w-[16rem] shrink-0 truncate">
        {searchError}
      </Badge>
    );
  } else if (noMatch) {
    searchVerdict = (
      <Badge variant="destructive" className="shrink-0">
        {t('logs.search.noMatch')}
      </Badge>
    );
  } else if (matchLine != null) {
    const key = hiddenLine === matchLine ? 'logs.search.matchHidden' : 'logs.search.matchAt';
    searchVerdict = (
      <Badge variant="outline" className="shrink-0 whitespace-nowrap">
        {t(key, { line: (matchLine + 1).toLocaleString() })}
      </Badge>
    );
  } else if (hiddenLine != null) {
    searchVerdict = (
      <Badge variant="outline" className="shrink-0 whitespace-nowrap">
        {t('logs.filter.lineHidden', { line: (hiddenLine + 1).toLocaleString() })}
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

  const lineStatus = filtering
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
                  href={selected == null ? undefined : logDownloadUrl(selected)}
                  aria-label={t('logs.action.download')}
                  download={selected}
                >
                  <Download className="size-4" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('logs.action.download')}</TooltipContent>
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
                  <span className={cn('font-mono text-xs', LEVEL_TOKEN_CLASS[level], LEVEL_EMPHASIS)}>
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
            onChange={(event) => {
              setQuery(event.target.value);
              setNoMatch(false);
              setSearchError(null);
            }}
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
          {searchVerdict}

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
