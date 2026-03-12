import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import {
    Camera,
    Ellipsis,
    Plus,
    RotateCcw,
    Trash2,
} from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
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
    const [restoreOpen, setRestoreOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const restoreMutation = useRestoreSnapshot();
    const deleteMutation = useDeleteSnapshot();

    const handleRestore = () => {
        restoreMutation.mutate(
            { snapshotName: snapshot.name },
            {
                onSuccess: () => {
                    toast.success(`Snapshot '${snapshot.name}' restored`);
                    setRestoreOpen(false);
                },
                onError: () => {
                    toast.error(`Failed to restore snapshot '${snapshot.name}'`);
                },
            },
        );
    };

    const handleDelete = () => {
        deleteMutation.mutate(snapshot.name, {
            onSuccess: () => {
                toast.success(`Snapshot '${snapshot.name}' deleted`);
                setDeleteOpen(false);
            },
            onError: () => {
                toast.error(`Failed to delete snapshot '${snapshot.name}'`);
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
                            Restore
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
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>

            <ConfirmDialog
                title="Restore Snapshot"
                description={`Are you sure you want to restore '${snapshot.name}'? This will overwrite existing data in the affected repositories.`}
                confirmLabel="Restore"
                variant="destructive"
                onConfirm={handleRestore}
                open={restoreOpen}
                onOpenChange={setRestoreOpen}
            />

            <ConfirmDialog
                title="Delete Snapshot"
                description={`Are you sure you want to delete '${snapshot.name}'? This action cannot be undone.`}
                confirmLabel="Delete"
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
    const [open, setOpen] = useState(false);
    const [repositoryId, setRepositoryId] = useState('');
    const { data: repositories } = useSuspenseQuery(repositoriesQueryOptions());
    const createMutation = useCreateSnapshot();

    const handleSubmit = () => {
        if (repositoryId === '') return;

        createMutation.mutate(repositoryId, {
            onSuccess: () => {
                toast.success('Snapshot created');
                setOpen(false);
                setRepositoryId('');
            },
            onError: () => {
                toast.error('Failed to create snapshot');
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
                    Create Snapshot
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create Snapshot</DialogTitle>
                    <DialogDescription>
                        Select a repository to create a snapshot for.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-4">
                    <Label htmlFor="snapshot-repo">Repository</Label>
                    <Select value={repositoryId} onValueChange={setRepositoryId}>
                        <SelectTrigger id="snapshot-repo">
                            <SelectValue placeholder="Select a repository" />
                        </SelectTrigger>
                        <SelectContent>
                            {repositories.map(repo => (
                                <SelectItem key={repo.id} value={repo.id}>
                                    {repo.id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button>Cancel</Button>
                    </DialogClose>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={repositoryId === '' || createMutation.isPending}
                    >
                        Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

//
// * SnapshotsPage
//

const SnapshotsPage = (): ReactElement => {
    const { data: snapshots } = useSuspenseQuery(snapshotsQueryOptions());

    const columns = [
        columnHelper.accessor('name', {
            header: 'Name',
            cell: info => info.getValue(),
        }),
        columnHelper.accessor('timestamp', {
            header: 'Timestamp',
            cell: info => formatTimestamp(info.getValue()),
        }),
        columnHelper.accessor('state', {
            header: 'State',
            cell: info => (
                <Badge variant={info.getValue() === 'SUCCESS' ? 'default' : 'destructive'}>
                    {info.getValue()}
                </Badge>
            ),
        }),
        columnHelper.accessor('indices', {
            header: 'Indices',
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
                <span className="font-medium font-mono text-foreground text-xs">Snapshots</span>
            </div>

            {/* Action toolbar */}
            <div className="flex items-center gap-2 px-4 py-2">
                <div className="flex-1" />
                <CreateSnapshotDialog />
            </div>

            {snapshots.length === 0 ? (
                <EmptyState
                    icon={Camera}
                    title="No snapshots"
                    description="No snapshots found. Create one to get started."
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
        Promise.all([
            queryClient.ensureQueryData(snapshotsQueryOptions()),
            queryClient.ensureQueryData(repositoriesQueryOptions()),
        ]),
    component: SnapshotsPage,
});
