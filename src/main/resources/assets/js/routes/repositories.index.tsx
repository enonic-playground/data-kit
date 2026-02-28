import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import {
    ChevronRight,
    Database,
    Ellipsis,
    Eye,
    LayoutGrid,
    LayoutList,
    Plus,
    Trash2,
} from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { z } from 'zod';
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
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { toast } from '../components/ui/sonner';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import {
    type Repository,
    repositoriesQueryOptions,
    useCreateRepository,
    useDeleteRepository,
} from '../lib/api/repositories';
import { cn } from '../lib/utils';

const REPOSITORIES_PAGE_NAME = 'RepositoriesPage';

const PROTECTED_REPOS = ['system-repo', 'com.enonic.cms.default'];

const repoIdSchema = z
    .string()
    .min(3, 'Must be at least 3 characters')
    .max(100, 'Must be at most 100 characters')
    .regex(
        /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/,
        'Must contain only lowercase letters, digits, dots, and hyphens',
    );

const columnHelper = createColumnHelper<Repository>();

//
// * RowActions
//

type RowActionsProps = {
    repo: Repository;
};

const RowActions = ({ repo }: RowActionsProps): ReactElement => {
    const [deleteOpen, setDeleteOpen] = useState(false);
    const navigate = useNavigate();
    const deleteMutation = useDeleteRepository();
    const isProtected = PROTECTED_REPOS.includes(repo.id);

    const handleDelete = () => {
        deleteMutation.mutate(repo.id, {
            onSuccess: () => {
                toast.success(`Repository '${repo.id}' deleted`);
                setDeleteOpen(false);
            },
            onError: () => {
                toast.error(`Failed to delete repository '${repo.id}'`);
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
                                navigate({
                                    to: '/repositories/$repoId',
                                    params: { repoId: repo.id },
                                });
                            }}
                        >
                            <Eye className="size-4" />
                            Preview
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
                title={isProtected ? 'Protected Repository' : 'Delete Repository'}
                description={
                    isProtected
                        ? `'${repo.id}' is a system repository and cannot be deleted.`
                        : `Are you sure you want to delete '${repo.id}'? This action cannot be undone.`
                }
                confirmLabel={isProtected ? 'OK' : 'Delete'}
                cancelLabel={isProtected ? 'Close' : 'Cancel'}
                variant={isProtected ? 'primary' : 'destructive'}
                onConfirm={isProtected ? () => setDeleteOpen(false) : handleDelete}
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
            />
        </>
    );
};

//
// * CreateRepositoryDialog
//

const CreateRepositoryDialog = (): ReactElement => {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const createMutation = useCreateRepository();

    const handleSubmit = () => {
        const result = repoIdSchema.safeParse(name);
        if (!result.success) {
            setError(result.error.issues[0].message);
            return;
        }

        createMutation.mutate(name, {
            onSuccess: () => {
                toast.success(`Repository '${name}' created`);
                setOpen(false);
                setName('');
                setError(null);
            },
            onError: () => {
                toast.error(`Failed to create repository '${name}'`);
            },
        });
    };

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            setName('');
            setError(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="size-4" />
                    Create Repository
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create Repository</DialogTitle>
                    <DialogDescription>
                        Enter a name for the new repository. Use lowercase
                        letters, digits, dots, and hyphens.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-4">
                    <Label htmlFor="repo-name">Repository Name</Label>
                    <Input
                        id="repo-name"
                        value={name}
                        onChange={e => {
                            setName(e.target.value);
                            setError(null);
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') handleSubmit();
                        }}
                        placeholder="my-repository"
                    />
                    {error != null && (
                        <p className="text-destructive text-sm">{error}</p>
                    )}
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button>Cancel</Button>
                    </DialogClose>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={createMutation.isPending}
                    >
                        Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

//
// * RepositoriesPage
//

const RepositoriesPage = (): ReactElement => {
    const { data: repositories } = useSuspenseQuery(
        repositoriesQueryOptions(),
    );
    const navigate = useNavigate();
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

    const columns = [
        columnHelper.accessor('id', {
            header: 'Name',
            cell: info => info.getValue(),
        }),
        columnHelper.accessor('branches', {
            header: 'Branches',
            cell: info => (
                <div className="flex flex-wrap gap-1">
                    {info.getValue().map(b => (
                        <Badge key={b} variant="secondary">{b}</Badge>
                    ))}
                </div>
            ),
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: info => (
                <div className="flex items-center justify-end gap-1">
                    <RowActions repo={info.row.original} />
                    <ChevronRight className="size-4 text-muted-foreground" />
                </div>
            ),
        }),
    ];

    const table = useReactTable({
        data: repositories,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    return (
        <div data-component={REPOSITORIES_PAGE_NAME} className="flex flex-col">
            {/* Breadcrumb bar */}
            <div className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-border border-b bg-card px-4">
                <span className="font-medium font-mono text-foreground text-xs">Repositories</span>
            </div>

            {/* Action toolbar */}
            <div className="flex items-center gap-2 px-4 py-2">
                <div className="flex-1" />
                <CreateRepositoryDialog />
                <Separator orientation="vertical" className="h-5" />
                <div className="flex items-center gap-0.5">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(viewMode === 'list' && 'bg-accent')}
                        onClick={() => setViewMode('list')}
                    >
                        <LayoutList className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(viewMode === 'grid' && 'bg-accent')}
                        onClick={() => setViewMode('grid')}
                    >
                        <LayoutGrid className="size-4" />
                    </Button>
                </div>
            </div>

            {repositories.length === 0 ? (
                <EmptyState
                    icon={Database}
                    title="No repositories"
                    description="No repositories found. Create one to get started."
                    action={<CreateRepositoryDialog />}
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
                            <TableRow
                                key={row.id}
                                className="cursor-pointer"
                                onClick={() =>
                                    navigate({
                                        to: '/repositories/$repoId',
                                        params: { repoId: row.original.id },
                                    })
                                }
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
            )}
        </div>
    );
};

RepositoriesPage.displayName = REPOSITORIES_PAGE_NAME;

export const Route = createFileRoute('/repositories/')({
    loader: ({ context: { queryClient } }) =>
        queryClient.ensureQueryData(repositoriesQueryOptions()),
    component: RepositoriesPage,
});
