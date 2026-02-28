import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, FileText, Folder, FolderOpen } from 'lucide-react';
import { Fragment, type ReactElement } from 'react';
import { z } from 'zod';
import { NodeDetailPanel } from '../components/node-detail-panel';
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
import { cn } from '../lib/utils';

const NODE_BROWSER_PAGE_NAME = 'NodeBrowserPage';

const DEFAULT_COUNT = 25;

const searchSchema = z.object({
    path: z.string().default('/'),
    start: z.number().int().min(0).default(0),
    count: z.number().int().min(1).max(100).default(DEFAULT_COUNT),
    nodeId: z.string().optional(),
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
// * BreadcrumbToolbar
//

type BreadcrumbToolbarProps = {
    repoId: string;
    branch: string;
    path: string;
    onNavigate: (path: string) => void;
};

const BREADCRUMB_TOOLBAR_NAME = 'BreadcrumbToolbar';

const crumbClasses = 'font-mono text-xs text-muted-foreground hover:text-foreground';
const crumbActiveClasses = 'font-medium font-mono text-xs text-foreground';
const separatorClasses = 'size-2.5 shrink-0 text-text-dimmed';

const BreadcrumbToolbar = ({
    repoId,
    branch,
    path,
    onNavigate,
}: BreadcrumbToolbarProps): ReactElement => {
    const segments = path === '/' ? [] : path.split('/').filter(Boolean);
    const isRootPath = segments.length === 0;

    return (
        <div
            data-component={BREADCRUMB_TOOLBAR_NAME}
            className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-border border-b bg-card px-4"
        >
            <Link to="/repositories" className={crumbClasses}>
                Repositories
            </Link>
            <ChevronRight className={separatorClasses} />
            <Link
                to="/repositories/$repoId"
                params={{ repoId }}
                className={crumbClasses}
            >
                {repoId}
            </Link>
            <ChevronRight className={separatorClasses} />
            <button
                type="button"
                className={isRootPath ? crumbActiveClasses : crumbClasses}
                onClick={() => onNavigate('/')}
            >
                {branch}
            </button>
            {segments.map((segment, index) => {
                const segmentPath = `/${segments.slice(0, index + 1).join('/')}`;
                const isLast = index === segments.length - 1;

                return (
                    <Fragment key={segmentPath}>
                        <ChevronRight className={separatorClasses} />
                        <button
                            type="button"
                            className={isLast ? crumbActiveClasses : crumbClasses}
                            onClick={() => onNavigate(segmentPath)}
                        >
                            {segment}
                        </button>
                    </Fragment>
                );
            })}
        </div>
    );
};

BreadcrumbToolbar.displayName = BREADCRUMB_TOOLBAR_NAME;

//
// * NodeBrowserPage
//

const NodeBrowserPage = (): ReactElement => {
    const { repoId, branch } = Route.useParams();
    const { path, start, count, nodeId } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });

    const { data } = useSuspenseQuery(
        nodesQueryOptions({ repoId, branch, parentPath: path, start, count }),
    );

    const navigateToPath = (newPath: string) => {
        navigate({
            search: { path: newPath, start: 0, count },
        });
    };

    const openNodeDetail = (id: string) => {
        navigate({
            search: (prev: Record<string, unknown>) => ({ ...prev, nodeId: id }),
        });
    };

    const closeNodeDetail = () => {
        navigate({
            search: (prev: Record<string, unknown>) => {
                const { nodeId: _, ...rest } = prev;
                return rest;
            },
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
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-mono text-[13px]">{node._name}</span>
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
                <span className="font-mono text-muted-foreground text-xs">
                    {formatTimestamp(info.getValue())}
                </span>
            ),
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: info => (
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={e => {
                        e.stopPropagation();
                        openNodeDetail(info.row.original._id);
                    }}
                >
                    <Eye className="size-3.5 text-muted-foreground" />
                </Button>
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
        <div data-component={NODE_BROWSER_PAGE_NAME} className="flex h-full flex-col">
            <BreadcrumbToolbar
                repoId={repoId}
                branch={branch}
                path={path}
                onNavigate={navigateToPath}
            />

            <div className="flex flex-1 overflow-hidden">
                {/* Table area */}
                <div className="flex flex-1 flex-col overflow-auto">
                    {data.nodes.length === 0 && isRoot ? (
                        <div className="flex flex-1 items-center justify-center">
                            <EmptyState
                                icon={FolderOpen}
                                title="No nodes"
                                description="This branch has no nodes yet."
                            />
                        </div>
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
                                                    <ArrowLeft className="size-3.5 shrink-0" />
                                                    <span className="font-mono text-[13px]">..</span>
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {table.getRowModel().rows.map(row => {
                                        const isSelected = nodeId === row.original._id;

                                        return (
                                            <TableRow
                                                key={row.id}
                                                className="cursor-pointer"
                                                data-state={isSelected ? 'selected' : undefined}
                                                onClick={() => {
                                                    if (row.original.hasChildren) {
                                                        navigateToPath(row.original._path);
                                                    } else {
                                                        openNodeDetail(row.original._id);
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
                                        );
                                    })}
                                </TableBody>
                            </Table>

                            {data.total > 0 && (
                                <div className={cn(
                                    'flex shrink-0 items-center justify-between px-4 py-3',
                                    'border-border border-t',
                                )}>
                                    <span className="font-mono text-muted-foreground text-xs">
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

                {/* Inline preview panel */}
                {nodeId != null && (
                    <NodeDetailPanel
                        nodeId={nodeId}
                        repoId={repoId}
                        branch={branch}
                        onClose={closeNodeDetail}
                    />
                )}
            </div>
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
