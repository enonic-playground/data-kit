import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { Label } from '../components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '../components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import { type Repository, repositoriesQueryOptions } from '../lib/api/repositories';
import { executeSearch, type SearchHit, type SearchParams, type SearchResponse } from '../lib/api/search';

const SEARCH_PAGE_NAME = 'SearchPage';

const ALL_REPOS = '__all__';

const DEFAULT_COUNT = 25;

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
    const { data: repositories } = useSuspenseQuery(repositoriesQueryOptions());

    const [query, setQuery] = useState('');
    const [repoId, setRepoId] = useState(ALL_REPOS);
    const [branch, setBranch] = useState('');
    const [start, setStart] = useState(0);
    const [result, setResult] = useState<SearchResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

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
            setError(apiErr.message ?? 'Search failed');
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
            searchMutation.mutate(params);
        },
        [query, repoId, branch, branches, searchMutation],
    );

    const handleSubmit = () => {
        doSearch(0);
    };

    const handleClear = () => {
        setQuery('');
        setResult(null);
        setError(null);
        setStart(0);
    };

    const handleRepoChange = (value: string) => {
        setRepoId(value);
        setBranch('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleSubmit();
        }
    };

    const columns = useMemo(
        () => [
            columnHelper.accessor('_score', {
                header: 'Score',
                cell: info => (
                    <span className="font-mono text-muted-foreground text-xs">
                        {info.getValue().toFixed(2)}
                    </span>
                ),
            }),
            columnHelper.accessor('_name', {
                header: 'Name',
                cell: info => (
                    <span className="font-mono text-[13px]">
                        {info.getValue() ?? '\u2014'}
                    </span>
                ),
            }),
            columnHelper.accessor('_path', {
                header: 'Path',
                cell: info => {
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
                            className="font-mono text-[13px] text-primary underline-offset-4 hover:underline"
                            onClick={e => e.stopPropagation()}
                        >
                            {path}
                        </Link>
                    );
                },
            }),
            columnHelper.accessor('_repoId', {
                header: 'Repository',
                cell: info => (
                    <Badge variant="secondary">{info.getValue()}</Badge>
                ),
            }),
            columnHelper.accessor('_branch', {
                header: 'Branch',
                cell: info => (
                    <Badge variant="outline">{info.getValue()}</Badge>
                ),
            }),
            columnHelper.accessor('_nodeType', {
                header: 'Type',
                cell: info => {
                    const value = info.getValue();
                    if (value == null) return <span className="text-muted-foreground">{'\u2014'}</span>;
                    return <Badge variant="secondary">{value}</Badge>;
                },
            }),
        ],
        [],
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
        <div data-component={SEARCH_PAGE_NAME} className="flex flex-col gap-4 p-6">
            {/* Filters + search bar */}
            <div className="flex flex-col gap-3">
                <div className="flex items-end gap-3">
                    <div>
                        <Label htmlFor="search-repo" className="text-xs">
                            Repository
                        </Label>
                        <Select value={repoId} onValueChange={handleRepoChange}>
                            <SelectTrigger id="search-repo" className="mt-1 h-9 w-48">
                                <SelectValue placeholder="All repositories" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_REPOS}>All repositories</SelectItem>
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
                                Branch
                            </Label>
                            <Select
                                value={branch || branches[0]}
                                onValueChange={setBranch}
                            >
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
                <div className="flex max-w-[460px] items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={query.trim() === '' || searchMutation.isPending}
                        className="shrink-0 text-muted-foreground disabled:opacity-40"
                    >
                        {searchMutation.isPending ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Search className="size-4" />
                        )}
                    </button>
                    <input
                        aria-label="NoQL query"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="_name LIKE '*test*'"
                        className="h-10 flex-1 bg-transparent px-3 font-mono text-sm placeholder:text-muted-foreground focus:outline-none"
                    />
                    {query !== '' && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                            <X className="size-4" />
                        </button>
                    )}
                </div>
            </div>

            {error != null && (
                <div className="max-w-[460px] rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm">
                    {error}
                </div>
            )}

            {result != null && result.hits.length === 0 && (
                <EmptyState
                    icon={Search}
                    title="No results"
                    description="No nodes matched your query. Try adjusting your search criteria."
                />
            )}

            {result != null && result.hits.length > 0 && (
                <>
                    <span className="font-mono text-muted-foreground text-xs">
                        {total.toLocaleString()} result{total !== 1 ? 's' : ''} — {result.executionTimeMs}ms
                    </span>

                    <Table>
                        <TableHeader>
                            {table.getHeaderGroups().map(headerGroup => (
                                <TableRow key={headerGroup.id}>
                                    {headerGroup.headers.map(header => (
                                        <TableHead key={header.id}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                      header.column.columnDef.header,
                                                      header.getContext(),
                                                  )}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {table.getRowModel().rows.map(row => (
                                <TableRow key={row.id}>
                                    {row.getVisibleCells().map(cell => (
                                        <TableCell key={cell.id}>
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext(),
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>

                    {total > DEFAULT_COUNT && (
                        <div className="flex items-center justify-between border-border border-t pt-3">
                            <span className="font-mono text-muted-foreground text-xs">
                                {start + 1}&ndash;{end} of {total.toLocaleString()}
                            </span>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!hasPrev || searchMutation.isPending}
                                    onClick={() => doSearch(Math.max(0, start - DEFAULT_COUNT))}
                                >
                                    <ChevronLeft className="size-4" />
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!hasNext || searchMutation.isPending}
                                    onClick={() => doSearch(start + DEFAULT_COUNT)}
                                >
                                    Next
                                    <ChevronRight className="size-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

SearchPage.displayName = SEARCH_PAGE_NAME;

export const Route = createFileRoute('/search')({
    loader: ({ context: { queryClient } }) =>
        queryClient.ensureQueryData(repositoriesQueryOptions()),
    component: SearchPage,
});
