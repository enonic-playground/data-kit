import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { ChevronRight, GitBranch, Plus, Trash2 } from 'lucide-react';
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
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
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
// * DeleteAction
//

type DeleteActionProps = {
    repoId: string;
    branch: Branch;
};

const DeleteAction = ({ repoId, branch }: DeleteActionProps): ReactElement => {
    const [open, setOpen] = useState(false);
    const deleteMutation = useDeleteBranch();
    const isProtected = PROTECTED_BRANCHES.includes(branch.id);

    const handleConfirm = () => {
        deleteMutation.mutate(
            { repoId, branchId: branch.id },
            {
                onSuccess: () => {
                    toast.success(`Branch '${branch.id}' deleted`);
                    setOpen(false);
                },
                onError: () => {
                    toast.error(`Failed to delete branch '${branch.id}'`);
                },
            },
        );
    };

    if (isProtected) {
        return (
            <ConfirmDialog
                title="Protected Branch"
                description={`'${branch.id}' is a default branch and cannot be deleted.`}
                confirmLabel="OK"
                cancelLabel="Close"
                variant="default"
                onConfirm={() => setOpen(false)}
                open={open}
                onOpenChange={setOpen}
            >
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={e => e.stopPropagation()}
                >
                    <Trash2 className="size-4 text-muted-foreground" />
                </Button>
            </ConfirmDialog>
        );
    }

    return (
        <ConfirmDialog
            title="Delete Branch"
            description={`Are you sure you want to delete '${branch.id}'? This action cannot be undone.`}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            variant="destructive"
            onConfirm={handleConfirm}
            open={open}
            onOpenChange={setOpen}
        >
            <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={e => e.stopPropagation()}
            >
                <Trash2 className="size-4 text-muted-foreground" />
            </Button>
        </ConfirmDialog>
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
                        <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button
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
    const { data: branches } = useSuspenseQuery(
        branchesQueryOptions(repoId),
    );
    const columns = [
        columnHelper.accessor('id', {
            header: 'Name',
            cell: info => (
                <span className="font-medium">{info.getValue()}</span>
            ),
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: info => <DeleteAction repoId={repoId} branch={info.row.original} />,
        }),
    ];

    const table = useReactTable({
        data: branches,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    return (
        <div data-component={BRANCH_LIST_PAGE_NAME} className="p-6">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <div className="mb-1 flex items-center gap-1.5 text-muted-foreground text-sm">
                        <Link
                            to="/repositories"
                            className="hover:text-foreground"
                        >
                            Repositories
                        </Link>
                        <ChevronRight className="size-3.5" />
                        <span className="text-foreground">{repoId}</span>
                    </div>
                    <h2 className="font-semibold text-2xl">Branches</h2>
                    <p className="mt-1 text-muted-foreground text-sm">
                        Manage branches in <span className="font-medium">{repoId}</span>.
                    </p>
                </div>
                <CreateBranchDialog repoId={repoId} />
            </div>

            {branches.length === 0 ? (
                <EmptyState
                    icon={GitBranch}
                    title="No branches"
                    description="No branches found. Create one to get started."
                    action={<CreateBranchDialog repoId={repoId} />}
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

BranchListPage.displayName = BRANCH_LIST_PAGE_NAME;

export const Route = createFileRoute('/repositories/$repoId')({
    loader: ({ context: { queryClient }, params: { repoId } }) =>
        queryClient.ensureQueryData(branchesQueryOptions(repoId)),
    component: BranchListPage,
});
