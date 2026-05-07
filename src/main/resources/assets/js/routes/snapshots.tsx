import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import {
    Camera,
    Ellipsis,
    KeyRound,
    Plus,
    RotateCcw,
    Trash2,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Code } from '../components/ui/code';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '../components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { EmptyState } from '../components/ui/empty-state';
import { Label } from '../components/ui/label';
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
import { repositoriesQueryOptions } from '../lib/api/repositories';
import {
    type Snapshot,
    snapshotsQueryOptions,
    useCreateSnapshot,
    useDeleteSnapshot,
    useRestoreSnapshot,
} from '../lib/api/snapshots';
import type { ApiError } from '../types/api';

const SNAPSHOTS_PAGE_NAME = 'SnapshotsPage';

function formatTimestamp(timestamp: string): string {
    try {
        return new Date(timestamp).toLocaleString();
    } catch {
        return timestamp;
    }
}

const columnHelper = createColumnHelper<Snapshot>();

//
// * RowActions
//

type RowActionsProps = {
    snapshot: Snapshot;
};

const RowActions = ({ snapshot }: RowActionsProps): ReactElement => {
    const { t } = useTranslation();
    const [restoreOpen, setRestoreOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const restoreMutation = useRestoreSnapshot();
    const deleteMutation = useDeleteSnapshot();

    const handleRestore = () => {
        restoreMutation.mutate(
            { snapshotName: snapshot.name },
            {
                onSuccess: () => {
                    toast.success(t('snapshot.toast.restored', { name: snapshot.name }));
                    setRestoreOpen(false);
                },
                onError: () => {
                    toast.error(t('snapshot.toast.restoreFailed', { name: snapshot.name }));
                },
            },
        );
    };

    const handleDelete = () => {
        deleteMutation.mutate(snapshot.name, {
            onSuccess: () => {
                toast.success(t('snapshot.toast.deleted', { name: snapshot.name }));
                setDeleteOpen(false);
            },
            onError: () => {
                toast.error(t('snapshot.toast.deleteFailed', { name: snapshot.name }));
            },
        });
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={e => e.stopPropagation()}
                    >
                        <Ellipsis className="size-4 text-muted-foreground" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            onClick={e => {
                                e.stopPropagation();
                                setRestoreOpen(true);
                            }}
                        >
                            <RotateCcw className="size-4" />
                            {t('snapshot.action.restore')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={e => {
                                e.stopPropagation();
                                setDeleteOpen(true);
                            }}
                        >
                            <Trash2 className="size-4" />
                            {t('common.action.delete')}
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>

            <ConfirmDialog
                title={t('snapshot.dialog.restore.title')}
                description={t('snapshot.dialog.restore.description', { name: snapshot.name })}
                confirmLabel={t('snapshot.action.restore')}
                variant="destructive"
                onConfirm={handleRestore}
                open={restoreOpen}
                onOpenChange={setRestoreOpen}
            />

            <ConfirmDialog
                title={t('snapshot.dialog.delete.title')}
                description={t('snapshot.dialog.delete.description', { name: snapshot.name })}
                confirmLabel={t('common.action.delete')}
                variant="destructive"
                onConfirm={handleDelete}
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
            />
        </>
    );
};

//
// * CreateSnapshotDialog
//

const CreateSnapshotDialog = (): ReactElement => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [repositoryId, setRepositoryId] = useState('');
    const { data: repositories } = useQuery(repositoriesQueryOptions());
    const createMutation = useCreateSnapshot();

    const handleSubmit = () => {
        if (repositoryId === '') return;

        createMutation.mutate(repositoryId, {
            onSuccess: () => {
                toast.success(t('snapshot.toast.created'));
                setOpen(false);
                setRepositoryId('');
            },
            onError: () => {
                toast.error(t('snapshot.toast.createFailed'));
            },
        });
    };

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            setRepositoryId('');
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="size-4" />
                    {t('snapshot.action.createSnapshot')}
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('snapshot.dialog.create.title')}</DialogTitle>
                    <DialogDescription>
                        {t('snapshot.dialog.create.description')}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-4">
                    <Label htmlFor="snapshot-repo">{t('snapshot.field.repository')}</Label>
                    <Select value={repositoryId} onValueChange={setRepositoryId}>
                        <SelectTrigger id="snapshot-repo">
                            <SelectValue placeholder={t('snapshot.field.selectRepository')} />
                        </SelectTrigger>
                        <SelectContent>
                            {repositories?.map(repo => (
                                <SelectItem key={repo.id} value={repo.id}>
                                    {repo.id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button>{t('common.action.cancel')}</Button>
                    </DialogClose>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={repositoryId === '' || createMutation.isPending}
                    >
                        {t('common.action.create')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

//
// * SnapshotsError
//

function isApiError(error: unknown): error is ApiError {
    return (
        typeof error === 'object' &&
        error != null &&
        'status' in error &&
        'message' in error
    );
}

function getErrorContent(error: unknown, t: (key: string) => string): { title: string; description: ReactNode } {
    if (!isApiError(error)) {
        return {
            title: t('snapshot.error.loadFailed.title'),
            description: t('snapshot.error.loadFailed.description'),
        };
    }

    if (error.code === 'FORBIDDEN') {
        return {
            title: t('snapshot.error.forbidden.title'),
            description: t('snapshot.error.forbidden.description'),
        };
    }

    if (error.code === 'MANAGEMENT_API_ERROR') {
        return {
            title: t('snapshot.error.managementApi.title'),
            description: (
                <Trans
                    i18nKey="snapshot.error.managementApi.description"
                    components={{ code: <Code /> }}
                />
            ),
        };
    }

    return {
        title: t('snapshot.error.loadFailed.title'),
        description: error.message,
    };
}

const SNAPSHOTS_ERROR_NAME = 'SnapshotsError';

const SnapshotsError = ({ error }: ErrorComponentProps): ReactElement => {
    const { t } = useTranslation();
    const { title, description } = getErrorContent(error, t);

    return (
        <div data-component={SNAPSHOTS_ERROR_NAME} className="flex flex-col">
            {/* Breadcrumb bar */}
            <div className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-border border-b bg-card px-4">
                <span className="font-medium font-mono text-foreground text-xs">{t('nav.snapshots')}</span>
            </div>

            {/* Action toolbar */}
            <div className="flex items-center gap-2 px-4 py-2">
                <div className="flex-1" />
                <Button disabled>
                    <Plus className="size-4" />
                    {t('snapshot.action.createSnapshot')}
                </Button>
            </div>

            <EmptyState
                icon={KeyRound}
                title={title}
                description={description}
            />
        </div>
    );
};

SnapshotsError.displayName = SNAPSHOTS_ERROR_NAME;

//
// * SnapshotsPage
//

const SnapshotsPage = (): ReactElement => {
    const { t } = useTranslation();
    const { data: snapshots } = useSuspenseQuery(snapshotsQueryOptions());
    const queryClient = useQueryClient();

    // ? Prefetch repositories in the background so the Create dialog opens instantly
    useEffect(() => {
        queryClient.prefetchQuery(repositoriesQueryOptions());
    }, [queryClient]);

    const columns = [
        columnHelper.accessor('name', {
            header: t('snapshot.column.name'),
            cell: info => info.getValue(),
        }),
        columnHelper.accessor('timestamp', {
            header: t('snapshot.column.timestamp'),
            cell: info => formatTimestamp(info.getValue()),
        }),
        columnHelper.accessor('state', {
            header: t('snapshot.column.state'),
            cell: info => (
                <Badge variant={info.getValue() === 'SUCCESS' ? 'default' : 'destructive'}>
                    {info.getValue()}
                </Badge>
            ),
        }),
        columnHelper.accessor('indices', {
            header: t('snapshot.column.indices'),
            cell: info => info.getValue().length,
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: info => (
                <div className="flex items-center justify-end gap-1">
                    <RowActions snapshot={info.row.original} />
                </div>
            ),
        }),
    ];

    const table = useReactTable({
        data: snapshots,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    return (
        <div data-component={SNAPSHOTS_PAGE_NAME} className="flex flex-col">
            {/* Breadcrumb bar */}
            <div className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-border border-b bg-card px-4">
                <span className="font-medium font-mono text-foreground text-xs">{t('nav.snapshots')}</span>
            </div>

            {/* Action toolbar */}
            <div className="flex items-center gap-2 px-4 py-2">
                <div className="flex-1" />
                <CreateSnapshotDialog />
            </div>

            {snapshots.length === 0 ? (
                <EmptyState
                    icon={Camera}
                    title={t('snapshot.empty.title')}
                    description={t('snapshot.empty.description')}
                    action={<CreateSnapshotDialog />}
                />
            ) : (
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
            )}
        </div>
    );
};

SnapshotsPage.displayName = SNAPSHOTS_PAGE_NAME;

export const Route = createFileRoute('/snapshots')({
    loader: ({ context: { queryClient } }) =>
        queryClient.ensureQueryData(snapshotsQueryOptions()),
    component: SnapshotsPage,
    errorComponent: SnapshotsError,
});
