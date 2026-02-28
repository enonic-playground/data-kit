import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import {
    ArrowLeft,
    ChevronRight,
    Ellipsis,
    Eye,
    GitBranch,
    LayoutGrid,
    LayoutList,
    Plus,
    Trash2,
} from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { z } from 'zod';
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
    type Branch,
    branchesQueryOptions,
    useCreateBranch,
    useDeleteBranch,
} from '../lib/api/branches';
import { cn } from '../lib/utils';

const BRANCH_LIST_PAGE_NAME = 'BranchListPage';

const PROTECTED_BRANCHES = ['master'];

const branchIdSchema = z
    .string()
    .min(2, 'Must be at least 2 characters')
    .max(100, 'Must be at most 100 characters')
    .regex(
        /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/,
        'Must contain only lowercase letters, digits, dots, and hyphens',
    );

const columnHelper = createColumnHelper<Branch>();

//
// * RowActions
//

type RowActionsProps = {
    repoId: string;
    branch: Branch;
};

const RowActions = ({ repoId, branch }: RowActionsProps): ReactElement => {
    const [deleteOpen, setDeleteOpen] = useState(false);
    const navigate = useNavigate();
    const deleteMutation = useDeleteBranch();
    const isProtected = PROTECTED_BRANCHES.includes(branch.id);

    const handleDelete = () => {
        deleteMutation.mutate(
            { repoId, branchId: branch.id },
            {
                onSuccess: () => {
                    toast.success(`Branch '${branch.id}' deleted`);
                    setDeleteOpen(false);
                },
                onError: () => {
                    toast.error(`Failed to delete branch '${branch.id}'`);
                },
            },
        );
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
                                    to: '/repositories/$repoId/$branch',
                                    params: { repoId, branch: branch.id },
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
                title={isProtected ? 'Protected Branch' : 'Delete Branch'}
                description={
                    isProtected
                        ? `'${branch.id}' is a default branch and cannot be deleted.`
                        : `Are you sure you want to delete '${branch.id}'? This action cannot be undone.`
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
// * CreateBranchDialog
//

type CreateBranchDialogProps = {
    repoId: string;
};

const CreateBranchDialog = ({ repoId }: CreateBranchDialogProps): ReactElement => {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const createMutation = useCreateBranch();

    const handleSubmit = () => {
        const result = branchIdSchema.safeParse(name);
        if (!result.success) {
            setError(result.error.issues[0].message);
            return;
        }

        createMutation.mutate(
            { repoId, branchId: name },
            {
                onSuccess: () => {
                    toast.success(`Branch '${name}' created`);
                    setOpen(false);
                    setName('');
                    setError(null);
                },
                onError: () => {
                    toast.error(`Failed to create branch '${name}'`);
                },
            },
        );
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
                    Create Branch
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create Branch</DialogTitle>
                    <DialogDescription>
                        Enter a name for the new branch. Use lowercase
                        letters, digits, dots, and hyphens.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-4">
                    <Label htmlFor="branch-name">Branch Name</Label>
                    <Input
                        id="branch-name"
                        value={name}
                        onChange={e => {
                            setName(e.target.value);
                            setError(null);
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') handleSubmit();
                        }}
                        placeholder="draft"
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
// * BranchListPage
//

const BranchListPage = (): ReactElement => {
    const { repoId } = Route.useParams();
    const navigate = useNavigate();
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const { data: branches } = useSuspenseQuery(
        branchesQueryOptions(repoId),
    );

    const columns = [
        columnHelper.accessor('id', {
            header: 'Name',
            cell: info => info.getValue(),
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: info => (
                <div className="flex items-center justify-end gap-1">
                    <RowActions repoId={repoId} branch={info.row.original} />
                    <ChevronRight className="size-4 text-muted-foreground" />
                </div>
            ),
        }),
    ];

    const table = useReactTable({
        data: branches,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    return (
        <div data-component={BRANCH_LIST_PAGE_NAME} className="flex flex-col">
            {/* Breadcrumb bar */}
            <div className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-border border-b bg-card px-4">
                <Link to="/repositories" className="font-mono text-muted-foreground text-xs hover:text-foreground">
                    Repositories
                </Link>
                <ChevronRight className="size-2.5 shrink-0 text-text-dimmed" />
                <span className="font-medium font-mono text-foreground text-xs">{repoId}</span>
            </div>

            {/* Action toolbar */}
            <div className="flex items-center gap-2 px-4 py-2">
                <div className="flex-1" />
                <CreateBranchDialog repoId={repoId} />
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
                    {/* Back row */}
                    <TableRow
                        className="cursor-pointer"
                        onClick={() => navigate({ to: '/repositories' })}
                    >
                        <TableCell colSpan={columns.length}>
                            <span className="flex min-h-8 items-center gap-2 text-muted-foreground">
                                <ArrowLeft className="size-3.5 shrink-0" />
                                <span className="text-[13px]">..</span>
                            </span>
                        </TableCell>
                    </TableRow>
                    {table.getRowModel().rows.map(row => (
                        <TableRow
                            key={row.id}
                            className="cursor-pointer"
                            onClick={() =>
                                navigate({
                                    to: '/repositories/$repoId/$branch',
                                    params: {
                                        repoId,
                                        branch: row.original.id,
                                    },
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
            {branches.length === 0 && (
                <EmptyState
                    icon={GitBranch}
                    title="No branches"
                    description="No branches found. Create one to get started."
                />
            )}
        </div>
    );
};

BranchListPage.displayName = BRANCH_LIST_PAGE_NAME;

export const Route = createFileRoute('/repositories/$repoId/')({
    loader: ({ context: { queryClient }, params: { repoId } }) =>
        queryClient.ensureQueryData(branchesQueryOptions(repoId)),
    component: BranchListPage,
});
