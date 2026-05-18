import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Download, Loader2, Search, X } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ValidationError as NoqlValidationError } from '../lib/noql/types';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { EmptyState } from '../components/ui/empty-state';
import { Label } from '../components/ui/label';
import { Progress } from '../components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { toast } from '../components/ui/sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { type Repository, repositoriesQueryOptions } from '../lib/api/repositories';
import {
  executeSearch,
  type SearchHit,
  type SearchParams,
  type SearchResponse,
} from '../lib/api/search';
import { downloadBlob, type ExportColumn, type ExportFormat, toCSV, toTSV } from '../lib/export';
import { validate as validateNoql } from '../lib/noql/validator';

const SEARCH_PAGE_NAME = 'SearchPage';

const ALL_REPOS = '__all__';

const DEFAULT_COUNT = 25;

const EXPORT_COLUMNS: ExportColumn<SearchHit>[] = [
  { key: '_id', header: 'ID' },
  { key: '_score', header: 'Score' },
  { key: '_name', header: 'Name' },
  { key: '_path', header: 'Path' },
  { key: '_repoId', header: 'Repository' },
  { key: '_branch', header: 'Branch' },
  { key: '_nodeType', header: 'Type' },
];

const MAX_EXPORT_RESULTS = 10_000;
const EXPORT_PAGE_SIZE = 100;

function formatExportTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

const columnHelper = createColumnHelper<SearchHit>();

function getParentPath(path: string): string {
  if (path === '/') return '/';
  const segments = path.split('/').filter(Boolean);
  segments.pop();
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

//
// * SearchPage
//

const SearchPage = (): ReactElement => {
  const { t } = useTranslation();
  const { data: repositories } = useSuspenseQuery(repositoriesQueryOptions());

  const [query, setQuery] = useState('');
  const [repoId, setRepoId] = useState(ALL_REPOS);
  const [branch, setBranch] = useState('');
  const [start, setStart] = useState(0);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [resultParams, setResultParams] = useState<SearchParams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<NoqlValidationError | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setValidationError(validateNoql(query));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const selectedRepo = useMemo(
    () => repositories.find((r: Repository) => r.id === repoId),
    [repositories, repoId],
  );

  const branches = useMemo(
    () => (selectedRepo != null ? selectedRepo.branches : []),
    [selectedRepo],
  );

  const searchMutation = useMutation({
    mutationFn: executeSearch,
    onSuccess: (data: SearchResponse) => {
      setResult(data);
      setError(null);
    },
    onError: (err: unknown) => {
      setResult(null);
      const apiErr = err as { message?: string; code?: string };
      setError(apiErr.message ?? t('search.error.failed'));
    },
  });

  const doSearch = useCallback(
    (searchStart: number) => {
      if (query.trim() === '') return;

      const params: SearchParams = {
        query: query.trim(),
        start: searchStart,
        count: DEFAULT_COUNT,
      };

      if (repoId !== ALL_REPOS) {
        params.repoId = repoId;
        params.branch = branch || (branches.length > 0 ? branches[0] : 'master');
      }

      setStart(searchStart);
      setResultParams(params);
      searchMutation.mutate(params);
    },
    [query, repoId, branch, branches, searchMutation],
  );

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleExport = async (format: ExportFormat) => {
    if (result == null || resultParams == null) return;

    const ext = format === 'csv' ? 'csv' : 'tsv';
    const mime = format === 'csv' ? 'text/csv' : 'text/tab-separated-values';
    const formatContent = (hits: SearchHit[]) =>
      format === 'csv' ? toCSV(hits, EXPORT_COLUMNS) : toTSV(hits, EXPORT_COLUMNS);

    const total = result.total;

    // Small result set — use already-fetched hits
    if (total <= DEFAULT_COUNT) {
      const count = result.hits.length;
      downloadBlob(formatContent(result.hits), `search-${formatExportTimestamp()}.${ext}`, mime);
      toast.success(t('search.toast.exported', { count }));
      return;
    }

    // Large result set — paginated fetch
    const controller = new AbortController();
    abortRef.current = controller;
    setExporting(true);
    setExportProgress(0);

    const totalToFetch = Math.min(total, MAX_EXPORT_RESULTS);
    const allHits: SearchHit[] = [];

    const baseParams: SearchParams = {
      ...resultParams,
      count: EXPORT_PAGE_SIZE,
    };

    try {
      while (allHits.length < totalToFetch) {
        controller.signal.throwIfAborted();

        const page = await executeSearch({
          ...baseParams,
          start: allHits.length,
        });
        allHits.push(...page.hits);
        if (page.hits.length === 0) break;

        setExportProgress(Math.min((allHits.length / totalToFetch) * 100, 100));
      }

      downloadBlob(formatContent(allHits), `search-${formatExportTimestamp()}.${ext}`, mime);
      if (total > MAX_EXPORT_RESULTS) {
        toast.warning(
          t('search.toast.exportedTruncated', {
            exported: allHits.length.toLocaleString(),
            total: total.toLocaleString(),
            limit: MAX_EXPORT_RESULTS.toLocaleString(),
          }),
        );
      } else {
        toast.success(t('search.toast.exported', { count: allHits.length }));
      }
    } catch (_err) {
      if (controller.signal.aborted) {
        toast.info(t('search.toast.exportCancelled'));
      } else {
        toast.error(t('search.toast.exportFailed'));
      }
    } finally {
      setExporting(false);
      setExportProgress(0);
      abortRef.current = null;
    }
  };

  const handleCancelExport = () => {
    abortRef.current?.abort();
  };

  const handleSubmit = () => {
    doSearch(0);
  };

  const handleClear = () => {
    abortRef.current?.abort();
    setQuery('');
    setResult(null);
    setResultParams(null);
    setError(null);
    setStart(0);
  };

  const handleRepoChange = (value: string) => {
    setRepoId(value);
    setBranch('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (exporting) return;
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor('_score', {
        header: t('search.column.score'),
        cell: (info) => (
          <span className="text-muted-foreground font-mono text-xs">
            {info.getValue().toFixed(2)}
          </span>
        ),
      }),
      columnHelper.accessor('_name', {
        header: t('search.column.name'),
        cell: (info) => (
          <span className="font-mono text-[13px]">{info.getValue() ?? '\u2014'}</span>
        ),
      }),
      columnHelper.accessor('_path', {
        header: t('search.column.path'),
        cell: (info) => {
          const hit = info.row.original;
          const path = info.getValue();
          if (path == null) return <span className="text-muted-foreground">{'\u2014'}</span>;

          return (
            <Link
              to="/repositories/$repoId/$branch"
              params={{
                repoId: hit._repoId,
                branch: hit._branch,
              }}
              search={{ path: getParentPath(path), nodeId: hit._id }}
              className="text-primary font-mono text-[13px] underline-offset-4 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {path}
            </Link>
          );
        },
      }),
      columnHelper.accessor('_repoId', {
        header: t('search.column.repository'),
        cell: (info) => <Badge variant="secondary">{info.getValue()}</Badge>,
      }),
      columnHelper.accessor('_branch', {
        header: t('search.column.branch'),
        cell: (info) => <Badge variant="outline">{info.getValue()}</Badge>,
      }),
      columnHelper.accessor('_nodeType', {
        header: t('search.column.type'),
        cell: (info) => {
          const value = info.getValue();
          if (value == null) return <span className="text-muted-foreground">{'\u2014'}</span>;
          return <Badge variant="secondary">{value}</Badge>;
        },
      }),
    ],
    [t],
  );

  const table = useReactTable({
    data: result?.hits ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const total = result?.total ?? 0;
  const end = Math.min(start + DEFAULT_COUNT, total);
  const hasPrev = start > 0;
  const hasNext = end < total;

  return (
    <div data-component={SEARCH_PAGE_NAME} className="flex flex-col gap-4">
      {/* Filters + search bar */}
      <div className="flex flex-col gap-3 px-4 pt-4">
        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="search-repo" className="text-xs">
              {t('search.label.repository')}
            </Label>
            <Select value={repoId} onValueChange={handleRepoChange}>
              <SelectTrigger id="search-repo" className="mt-1 h-9 w-48">
                <SelectValue placeholder={t('search.label.allRepositories')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_REPOS}>{t('search.label.allRepositories')}</SelectItem>
                {repositories.map((repo: Repository) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {repoId !== ALL_REPOS && branches.length > 0 && (
            <div>
              <Label htmlFor="search-branch" className="text-xs">
                {t('search.label.branch')}
              </Label>
              <Select value={branch || branches[0]} onValueChange={setBranch}>
                <SelectTrigger id="search-branch" className="mt-1 h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b: string) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Search bar */}
        <div className="border-input bg-background focus-within:ring-ring flex max-w-[460px] items-center rounded-md border px-3 focus-within:ring-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={exporting || query.trim() === '' || searchMutation.isPending}
            className="text-muted-foreground shrink-0 disabled:opacity-40"
          >
            {searchMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
          </button>
          <input
            aria-label={t('search.aria.queryInput')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('search.field.queryPlaceholder')}
            className="placeholder:text-muted-foreground h-10 flex-1 bg-transparent px-3 font-mono text-sm focus:outline-none"
          />
          {query !== '' && (
            <button
              type="button"
              onClick={handleClear}
              className="text-muted-foreground hover:text-foreground shrink-0"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {validationError != null && (
          <p className="text-destructive mt-2 max-w-[460px] text-sm">
            {validationError.message}
            {validationError.suggestion != null && ` ${validationError.suggestion}`}
          </p>
        )}
      </div>

      {error != null && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive mx-4 max-w-[460px] rounded-md border p-3 text-sm">
          {error}
        </div>
      )}

      {result != null && result.hits.length === 0 && (
        <EmptyState
          icon={Search}
          title={t('search.empty.title')}
          description={t('search.empty.description')}
        />
      )}

      {result != null && result.hits.length > 0 && (
        <>
          <div className="flex items-center gap-2 px-4">
            <span className="text-muted-foreground font-mono text-xs">
              {t('search.stats', {
                total: total.toLocaleString(),
                count: total,
                ms: result.executionTimeMs,
              })}
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              disabled={exporting || searchMutation.isPending}
              onClick={() => handleExport('csv')}
            >
              <Download className="size-4" /> CSV
            </Button>
            <Button
              size="sm"
              disabled={exporting || searchMutation.isPending}
              onClick={() => handleExport('tsv')}
            >
              <Download className="size-4" /> TSV
            </Button>
          </div>

          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {total > DEFAULT_COUNT && (
            <div className="border-border flex items-center justify-between border-t px-4 pt-3">
              <span className="text-muted-foreground font-mono text-xs">
                {t('common.pagination.range', {
                  start: start + 1,
                  end,
                  total: total.toLocaleString(),
                })}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={exporting || !hasPrev || searchMutation.isPending}
                  onClick={() => doSearch(Math.max(0, start - DEFAULT_COUNT))}
                >
                  <ChevronLeft className="size-4" />
                  {t('common.pagination.previous')}
                </Button>
                <Button
                  size="sm"
                  disabled={exporting || !hasNext || searchMutation.isPending}
                  onClick={() => doSearch(start + DEFAULT_COUNT)}
                >
                  {t('common.pagination.next')}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <Dialog open={exporting}>
        <DialogContent
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="[&>button:last-child]:hidden"
        >
          <DialogHeader>
            <DialogTitle>{t('search.dialog.export.title')}</DialogTitle>
            <DialogDescription>{t('search.dialog.export.description')}</DialogDescription>
          </DialogHeader>
          <Progress value={exportProgress} className="w-full" />
          <p className="text-muted-foreground text-center text-sm">{Math.round(exportProgress)}%</p>
          <DialogFooter>
            <Button onClick={handleCancelExport}>{t('common.action.cancel')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

SearchPage.displayName = SEARCH_PAGE_NAME;

export const Route = createFileRoute('/search')({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(repositoriesQueryOptions()),
  component: SearchPage,
});
