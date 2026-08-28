import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Download,
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

import type { LogViewerHandle } from '../components/log-viewer/log-viewer';
import type { LogSearchDirection } from '../lib/api/logs';
import type { ApiError } from '../types/api';

import { LogViewer } from '../components/log-viewer/log-viewer';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
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
  logDownloadUrl,
  logFilesQueryOptions,
  logInfoQueryOptions,
  searchLog,
} from '../lib/api/logs';

const LOGS_PAGE_NAME = 'LogsPage';

// ? Following a live file needs a tight poll; an idle rotated file does not.
const FOLLOW_POLL_MS = 1000;
const IDLE_POLL_MS = 5000;

const searchSchema = z.object({
  file: z.string().optional(),
});

/** Where the next search resumes; `inclusive` keeps `line` itself a candidate. */
type SearchCursor = { line: number; inclusive: boolean };

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
  const searchingRef = useRef(false);

  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const { file: fileParam } = Route.useSearch();

  const [follow, setFollow] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [query, setQuery] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [noMatch, setNoMatch] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [gotoValue, setGotoValue] = useState('');

  const { data: files = [] } = useQuery(logFilesQueryOptions());

  const selected = useMemo(() => {
    if (fileParam != null && files.some((entry) => entry.name === fileParam)) return fileParam;
    return (files.find((entry) => entry.active) ?? files[0])?.name;
  }, [fileParam, files]);

  const { data: info } = useQuery(
    logInfoQueryOptions(selected, follow ? FOLLOW_POLL_MS : IDLE_POLL_MS),
  );

  const selectedFile = useMemo(
    () => files.find((entry) => entry.name === selected),
    [files, selected],
  );

  const highlight = useMemo(() => {
    if (query === '') return null;
    try {
      return new RegExp(useRegex ? query : escapeRegExp(query), caseSensitive ? 'g' : 'gi');
    } catch {
      return null;
    }
  }, [query, useRegex, caseSensitive]);

  const total = info?.lines ?? 0;
  const size = info?.size ?? selectedFile?.size ?? 0;
  const modified = info?.modified ?? selectedFile?.modified;

  const handleSelectFile = useCallback(
    (name: string) => {
      void navigate({ search: { file: name }, replace: true });
    },
    [navigate],
  );

  const runSearch = useCallback(
    (direction: LogSearchDirection) => {
      if (selected == null || query === '' || searchingRef.current) return;

      // ? Stepping off the last match only makes sense while it is still on
      // ? screen; once the user has scrolled away, the viewport is the anchor.
      const range = viewerRef.current?.getVisibleRange() ?? null;
      const cursor = cursorRef.current;
      const anchor =
        cursor != null &&
        (range == null || (cursor.line >= range.first && cursor.line <= range.last))
          ? cursor
          : null;

      const forward = direction === 'forward';
      const fromViewport = forward ? (range?.first ?? 0) : (range?.last ?? total - 1);
      const step = forward ? 1 : -1;
      const from = anchor != null ? anchor.line + (anchor.inclusive ? 0 : step) : fromViewport;

      setSearchError(null);

      if (from < 0 || from >= total) {
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
          cursorRef.current = { line: result.line, inclusive: false };
          setFollow(false);
          viewerRef.current?.scrollToLine(result.line, 'center');
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
    [caseSensitive, query, selected, t, total, useRegex],
  );

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      runSearch(event.shiftKey ? 'backward' : 'forward');
    },
    [runSearch],
  );

  const handleGoto = useCallback(() => {
    const parsed = Number.parseInt(gotoValue, 10);
    if (!Number.isFinite(parsed) || total === 0) return;
    const line = Math.max(0, Math.min(parsed - 1, total - 1));
    // ? The jump centres the line, so the viewport reaches back above it and
    // ? forward below it; the next search has to resume from the line itself.
    cursorRef.current = { line, inclusive: true };
    setFollow(false);
    viewerRef.current?.scrollToLine(line, 'center');
  }, [gotoValue, total]);

  const handleTop = useCallback(() => {
    setFollow(false);
    cursorRef.current = null;
    viewerRef.current?.scrollToLine(0, 'start');
  }, []);

  const handleBottom = useCallback(() => {
    if (total === 0) return;
    cursorRef.current = null;
    setFollow(true);
    viewerRef.current?.scrollToLine(total - 1, 'end');
  }, [total]);

  const handleRefresh = useCallback(() => {
    viewerRef.current?.reload();
    void queryClient.invalidateQueries({ queryKey: ['logs'] });
  }, [queryClient]);

  const handleScrollAway = useCallback(() => {
    setFollow(false);
  }, []);

  useEffect(() => {
    cursorRef.current = null;
    setNoMatch(false);
    setSearchError(null);
    return () => {
      searchAbortRef.current?.abort();
    };
  }, [selected]);

  // ? A match cursor holds a hit of the previous criteria, so it cannot be
  // ? stepped off once the criteria change; a goto cursor is criteria-agnostic
  // ? and survives. A request still in flight would reinstate the match cursor
  // ? when it lands, so it goes too, along with the verdict the badges are
  // ? still asserting for criteria no longer in effect.
  useEffect(() => {
    if (cursorRef.current?.inclusive === false) cursorRef.current = null;
    searchAbortRef.current?.abort();
    setNoMatch(false);
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

  return (
    <div data-component={LOGS_PAGE_NAME} className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-border bg-card flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
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
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant={follow ? 'primary' : 'ghost'}
          aria-pressed={follow}
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

        <div className="bg-border mx-1 h-5 w-px" />

        {/* Search */}
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
          className="h-8 w-[16rem] font-mono text-xs"
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
        {noMatch && <Badge variant="destructive">{t('logs.search.noMatch')}</Badge>}
        {searchError != null && <Badge variant="destructive">{searchError}</Badge>}

        <div className="bg-border mx-1 h-5 w-px" />

        {/* Go to line */}
        <Input
          value={gotoValue}
          onChange={(event) => setGotoValue(event.target.value)}
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

        <div className="ml-auto flex items-center gap-2">
          <IconAction label={t('logs.action.top')} onClick={handleTop}>
            <ArrowUpToLine className="size-4" />
          </IconAction>
          <IconAction label={t('logs.action.bottom')} onClick={handleBottom}>
            <ArrowDownToLine className="size-4" />
          </IconAction>
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
          <IconAction label={t('common.action.refresh')} onClick={handleRefresh}>
            <RefreshCw className="size-4" />
          </IconAction>
        </div>
      </div>

      {/* Viewer */}
      {selected == null ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          {t('logs.viewer.selectFile')}
        </div>
      ) : (
        <LogViewer
          ref={viewerRef}
          className="min-h-0 flex-1"
          file={selected}
          total={total}
          size={info?.size ?? 0}
          wrap={wrap}
          highlight={highlight}
          follow={follow}
          onUserScrollAway={handleScrollAway}
        />
      )}

      {/* Status footer */}
      <div className="border-border bg-card text-muted-foreground flex h-7 shrink-0 items-center gap-4 border-t px-4 text-xs">
        <span className="font-mono">{selected ?? '—'}</span>
        <span>{t('logs.status.lines', { total: total.toLocaleString() })}</span>
        <span>{t('logs.status.size', { size: formatSize(size) })}</span>
        <span>{t('logs.status.modified', { modified: formatTimestamp(modified) })}</span>
        {follow && <Badge variant="outline">{t('logs.status.following')}</Badge>}
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
