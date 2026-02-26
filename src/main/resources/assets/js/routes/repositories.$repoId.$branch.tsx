import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, FileText, Folder, FolderOpen } from 'lucide-react';
import type { ReactElement } from 'react';
import { z } from 'zod';
import { NodeBreadcrumbs } from '../components/node-breadcrumbs';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import { type NodeEntry, nodesQueryOptions } from '../lib/api/nodes';

const NODE_BROWSER_PAGE_NAME = 'NodeBrowserPage';

const DEFAULT_COUNT = 25;

const searchSchema = z.object({
    path: z.string().default('/'),
    start: z.number().int().min(0).default(0),
    count: z.number().int().min(1).max(100).default(DEFAULT_COUNT),
});

const columnHelper = createColumnHelper<NodeEntry>();

function formatTimestamp(ts: string): string {
    try {
        const date = new Date(ts);
        return date.toLocaleString();
    } catch {
        return ts;
    }
}

function getParentPath(path: string): string {
    if (path === '/') return '/';
    const segments = path.split('/').filter(Boolean);
    segments.pop();
    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

//
// * NodeBrowserPage
//

const NodeBrowserPage = (): ReactElement => {
    const { repoId, branch } = Route.useParams();
    const { path, start, count } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    const { data } = useSuspenseQuery(
        nodesQueryOptions({ repoId, branch, parentPath: path, start, count }),
    );

    const navigateToPath = (newPath: string) => {
        navigate({
            search: { path: newPath, start: 0, count },
        });
    };

    const columns = [
        columnHelper.accessor('_name', {
            header: 'Name',
            cell: info => {
                const node = info.row.original;
                const Icon = node.hasChildren ? Folder : FileText;

                return (
                    <span className="flex items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{node._name}</span>
                    </span>
                );
            },
        }),
        columnHelper.accessor('_nodeType', {
            header: 'Type',
            cell: info => (
                <Badge variant="secondary">{info.getValue()}</Badge>
            ),
        }),
        columnHelper.accessor('_ts', {
            header: 'Modified',
            cell: info => (
                <span className="text-muted-foreground text-sm">
                    {formatTimestamp(info.getValue())}
                </span>
            ),
        }),
    ];

    const table = useReactTable({
        data: data.nodes,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    const isRoot = path === '/';
    const end = Math.min(start + count, data.total);
    const hasPrev = start > 0;
    const hasNext = end < data.total;

    return (
        <div data-component={NODE_BROWSER_PAGE_NAME} className="p-6">
            <div className="mb-6">
                <div className="mb-1 flex items-center gap-1.5 text-muted-foreground text-sm">
                    <Link
                        to="/repositories"
                        className="hover:text-foreground"
                    >
                        Repositories
                    </Link>
                    <ChevronRight className="size-3.5" />
                    <Link
                        to="/repositories/$repoId"
                        params={{ repoId }}
                        className="hover:text-foreground"
                    >
                        {repoId}
                    </Link>
                    <ChevronRight className="size-3.5" />
                    <span className="text-foreground">{branch}</span>
                    <NodeBreadcrumbs
                        path={path}
                        onNavigate={navigateToPath}
                    />
                </div>
                <h2 className="font-semibold text-2xl">Nodes</h2>
                <p className="mt-1 text-muted-foreground text-sm">
                    Browse nodes in{' '}
                    <span className="font-medium">{repoId}</span>
                    {' / '}
                    <span className="font-medium">{branch}</span>
                </p>
            </div>

            {data.nodes.length === 0 && isRoot ? (
                <EmptyState
                    icon={FolderOpen}
                    title="No nodes"
                    description="This branch has no nodes yet."
                />
            ) : (
                <>
                    <Table>
                        <TableHeader>
                            {table.getHeaderGroups().map(headerGroup => (
                                <TableRow key={headerGroup.id}>
                                    {headerGroup.headers.map(header => (
                                        <TableHead key={header.id}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                      header.column.columnDef
                                                          .header,
                                                      header.getContext(),
                                                  )}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {!isRoot && (
                                <TableRow
                                    className="cursor-pointer"
                                    onClick={() => navigateToPath(getParentPath(path))}
                                >
                                    <TableCell colSpan={columns.length}>
                                        <span className="flex items-center gap-2 text-muted-foreground">
                                            <Folder className="size-4 shrink-0" />
                                            <span>..</span>
                                        </span>
                                    </TableCell>
                                </TableRow>
                            )}
                            {table.getRowModel().rows.map(row => (
                                <TableRow
                                    key={row.id}
                                    className={
                                        row.original.hasChildren
                                            ? 'cursor-pointer'
                                            : undefined
                                    }
                                    onClick={() => {
                                        if (row.original.hasChildren) {
                                            navigateToPath(row.original._path);
                                        }
                                    }}
                                >
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

                    {data.total > 0 && (
                        <div className="mt-4 flex items-center justify-between">
                            <span className="text-muted-foreground text-sm">
                                {start + 1}&ndash;{end} of {data.total}
                            </span>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!hasPrev}
                                    onClick={() =>
                                        navigate({
                                            search: {
                                                path,
                                                start: Math.max(0, start - count),
                                                count,
                                            },
                                        })
                                    }
                                >
                                    <ChevronLeft className="size-4" />
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!hasNext}
                                    onClick={() =>
                                        navigate({
                                            search: {
                                                path,
                                                start: start + count,
                                                count,
                                            },
                                        })
                                    }
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

NodeBrowserPage.displayName = NODE_BROWSER_PAGE_NAME;

export const Route = createFileRoute('/repositories/$repoId/$branch')({
    validateSearch: searchSchema,
    loaderDeps: ({ search }) => search,
    loader: ({ context: { queryClient }, params: { repoId, branch }, deps: { path, start, count } }) =>
        queryClient.ensureQueryData(
            nodesQueryOptions({ repoId, branch, parentPath: path, start, count }),
        ),
    component: NodeBrowserPage,
});
