import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { Database, Plus, Trash2 } from 'lucide-react';
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
    type Repository,
    repositoriesQueryOptions,
    useCreateRepository,
    useDeleteRepository,
} from '../lib/api/repositories';

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

const columns = [
    columnHelper.accessor('id', {
        header: 'Name',
        cell: info => (
            <span className="font-medium">{info.getValue()}</span>
        ),
    }),
    columnHelper.accessor('branches', {
        header: 'Branches',
        cell: info => (
            <Badge variant="secondary">
                {info.getValue().length}
            </Badge>
        ),
    }),
    columnHelper.display({
        id: 'actions',
        header: '',
        cell: info => <DeleteAction repo={info.row.original} />,
    }),
];

//
// * DeleteAction
//

type DeleteActionProps = {
    repo: Repository;
};

const DeleteAction = ({ repo }: DeleteActionProps): ReactElement => {
    const [open, setOpen] = useState(false);
    const deleteMutation = useDeleteRepository();
    const isProtected = PROTECTED_REPOS.includes(repo.id);

    const handleConfirm = () => {
        deleteMutation.mutate(repo.id, {
            onSuccess: () => {
                toast.success(`Repository '${repo.id}' deleted`);
                setOpen(false);
            },
            onError: () => {
                toast.error(`Failed to delete repository '${repo.id}'`);
            },
        });
    };

    if (isProtected) {
        return (
            <ConfirmDialog
                title="Protected Repository"
                description={`'${repo.id}' is a system repository and cannot be deleted.`}
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
            title="Delete Repository"
            description={`Are you sure you want to delete '${repo.id}'? This action cannot be undone.`}
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
// * RepositoriesPage
//

const RepositoriesPage = (): ReactElement => {
    const { data: repositories } = useSuspenseQuery(
        repositoriesQueryOptions(),
    );
    const navigate = useNavigate();

    const table = useReactTable({
        data: repositories,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    return (
        <div data-component={REPOSITORIES_PAGE_NAME} className="p-6">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h2 className="font-semibold text-2xl">Repositories</h2>
                    <p className="mt-1 text-muted-foreground text-sm">
                        Manage repositories and browse their data.
                    </p>
                </div>
                <CreateRepositoryDialog />
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

export const Route = createFileRoute('/repositories')({
    loader: ({ context: { queryClient } }) =>
        queryClient.ensureQueryData(repositoriesQueryOptions()),
    component: RepositoriesPage,
});
