import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { ArrowLeft, ArrowRightLeft, ChevronLeft, ChevronRight, Copy, Ellipsis, Eye, FileText, Folder, FolderOpen, LayoutGrid, LayoutList, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { Fragment, type ReactElement, useState } from 'react';
import { z } from 'zod';
import { NodeDetailPanel } from '../components/node-detail-panel';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '../components/ui/select';
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
import { branchesQueryOptions } from '../lib/api/branches';
import {
    type NodeEntry,
    nodesQueryOptions,
    useCreateNode,
    useDeleteNode,
    useDuplicateNode,
    useMoveNode,
    usePushNode,
    useRenameNode,
} from '../lib/api/nodes';
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
// * RenameDialog
//

type RenameDialogProps = {
    node: NodeEntry;
    repoId: string;
    branch: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

const RenameDialog = ({ node, repoId, branch, open, onOpenChange }: RenameDialogProps): ReactElement => {
    const [name, setName] = useState(node._name);
    const [error, setError] = useState<string | undefined>();
    const renameMutation = useRenameNode();

    const handleSubmit = () => {
        if (name.trim() === '') {
            setError('Name is required');
            return;
        }
        if (name.includes('/')) {
            setError('Name cannot contain slashes');
            return;
        }
        if (name === node._name) {
            setError('Name must be different from current');
            return;
        }

        renameMutation.mutate(
            { repoId, branch, key: node._id, newName: name },
            {
                onSuccess: () => {
                    toast.success(`Node renamed to '${name}'`);
                    onOpenChange(false);
                },
                onError: () => {
                    toast.error('Failed to rename node');
                },
            },
        );
    };

    const handleOpenChange = (nextOpen: boolean) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
            setName(node._name);
            setError(undefined);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Rename Node</DialogTitle>
                    <DialogDescription>
                        Enter a new name for &apos;{node._name}&apos;.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-4">
                    <Label htmlFor="rename-name">Name</Label>
                    <Input
                        id="rename-name"
                        value={name}
                        onChange={e => {
                            setName(e.target.value);
                            setError(undefined);
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') handleSubmit();
                        }}
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
                        disabled={renameMutation.isPending}
                    >
                        Rename
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

//
// * MoveDialog
//

type MoveDialogProps = {
    node: NodeEntry;
    repoId: string;
    branch: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

const MoveDialog = ({ node, repoId, branch, open, onOpenChange }: MoveDialogProps): ReactElement => {
    const [targetPath, setTargetPath] = useState('');
    const [error, setError] = useState<string | undefined>();
    const moveMutation = useMoveNode();

    const handleSubmit = () => {
        if (targetPath.trim() === '') {
            setError('Target path is required');
            return;
        }
        if (!targetPath.startsWith('/')) {
            setError('Path must start with /');
            return;
        }

        moveMutation.mutate(
            { repoId, branch, key: node._id, targetPath },
            {
                onSuccess: () => {
                    toast.success(`Node moved to '${targetPath}'`);
                    onOpenChange(false);
                },
                onError: () => {
                    toast.error('Failed to move node');
                },
            },
        );
    };

    const handleOpenChange = (nextOpen: boolean) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
            setTargetPath('');
            setError(undefined);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Move Node</DialogTitle>
                    <DialogDescription>
                        Move &apos;{node._name}&apos; to a new parent path.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-1">
                        <Label className="text-muted-foreground">Current Path</Label>
                        <button
                            type="button"
                            className="cursor-pointer truncate text-left font-mono text-sm hover:text-foreground"
                            title="Click to copy path"
                            onClick={() => {
                                navigator.clipboard.writeText(node._path);
                                toast.success('Path copied to clipboard');
                            }}
                        >
                            {node._path}
                        </button>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="move-path">Target Path</Label>
                        <Input
                            id="move-path"
                            value={targetPath}
                            onChange={e => {
                                setTargetPath(e.target.value);
                                setError(undefined);
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleSubmit();
                            }}
                            placeholder="/target/path"
                        />
                        {error != null && (
                            <p className="text-destructive text-sm">{error}</p>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button>Cancel</Button>
                    </DialogClose>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={moveMutation.isPending}
                    >
                        Move
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

//
// * PushDialog
//

type PushDialogProps = {
    node: NodeEntry;
    repoId: string;
    branch: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

const PushDialog = ({ node, repoId, branch, open, onOpenChange }: PushDialogProps): ReactElement => {
    const [target, setTarget] = useState('');
    const [includeChildren, setIncludeChildren] = useState(false);
    const [resolve, setResolve] = useState(true);
    const pushMutation = usePushNode();

    const { data: branches } = useQuery(branchesQueryOptions(repoId));
    const availableBranches = branches?.filter(b => b.id !== branch) ?? [];

    const handleSubmit = () => {
        if (target === '') return;

        pushMutation.mutate(
            { repoId, branch, key: node._id, target, includeChildren, resolve },
            {
                onSuccess: (result) => {
                    const successCount = result.success.length;
                    const failedCount = result.failed.length;
                    if (failedCount > 0) {
                        toast.warning(`Pushed to '${target}': ${successCount} succeeded, ${failedCount} failed`);
                    } else {
                        toast.success(`Pushed to '${target}': ${successCount} nodes`);
                    }
                    onOpenChange(false);
                },
                onError: () => {
                    toast.error('Failed to push node');
                },
            },
        );
    };

    const handleOpenChange = (nextOpen: boolean) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
            setTarget('');
            setIncludeChildren(false);
            setResolve(true);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Push Node</DialogTitle>
                    <DialogDescription>
                        Push &apos;{node._name}&apos; to another branch.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Target Branch</Label>
                        <Select value={target} onValueChange={setTarget}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select branch" />
                            </SelectTrigger>
                            <SelectContent>
                                {availableBranches.map(b => (
                                    <SelectItem key={b.id} value={b.id}>
                                        {b.id}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="push-children"
                            checked={includeChildren}
                            onCheckedChange={checked => setIncludeChildren(checked === true)}
                        />
                        <Label htmlFor="push-children" className="font-normal">
                            Include children
                        </Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="push-resolve"
                            checked={resolve}
                            onCheckedChange={checked => setResolve(checked === true)}
                        />
                        <Label htmlFor="push-resolve" className="font-normal">
                            Resolve dependencies
                        </Label>
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button>Cancel</Button>
                    </DialogClose>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={pushMutation.isPending || target === ''}
                    >
                        Push
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

//
// * RowActions
//

type RowActionsProps = {
    node: NodeEntry;
    repoId: string;
    branch: string;
    onPreview: (id: string) => void;
    onDeleted?: () => void;
};

const RowActions = ({ node, repoId, branch, onPreview, onDeleted }: RowActionsProps): ReactElement => {
    const [renameOpen, setRenameOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);
    const [pushOpen, setPushOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteAllBranches, setDeleteAllBranches] = useState(false);
    const duplicateMutation = useDuplicateNode();
    const deleteMutation = useDeleteNode();

    const handleDuplicate = () => {
        duplicateMutation.mutate(
            { repoId, branch, nodeId: node._id },
            {
                onSuccess: (result) => {
                    toast.success(`Node duplicated as '${result._name}'`);
                },
                onError: () => {
                    toast.error(`Failed to duplicate node '${node._name}'`);
                },
            },
        );
    };

    const handleDelete = () => {
        deleteMutation.mutate(
            { repoId, branch, key: node._id, allBranches: deleteAllBranches || undefined },
            {
                onSuccess: (result) => {
                    if (result.branches != null) {
                        const count = result.branches.deleted.length;
                        toast.success(`Node '${node._name}' deleted from ${count} branch${count !== 1 ? 'es' : ''}`);
                    } else {
                        toast.success(`Node '${node._name}' deleted`);
                    }
                    setDeleteOpen(false);
                    setDeleteAllBranches(false);
                    onDeleted?.();
                },
                onError: () => {
                    toast.error(`Failed to delete node '${node._name}'`);
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
                                onPreview(node._id);
                            }}
                        >
                            <Eye className="size-4" />
                            Preview
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            onClick={e => {
                                e.stopPropagation();
                                setRenameOpen(true);
                            }}
                        >
                            <Pencil className="size-4" />
                            Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={e => {
                                e.stopPropagation();
                                setMoveOpen(true);
                            }}
                        >
                            <ArrowRightLeft className="size-4" />
                            Move
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={e => {
                                e.stopPropagation();
                                handleDuplicate();
                            }}
                        >
                            <Copy className="size-4" />
                            Duplicate
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            onClick={e => {
                                e.stopPropagation();
                                setPushOpen(true);
                            }}
                        >
                            <Send className="size-4" />
                            Push
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

            <RenameDialog
                node={node}
                repoId={repoId}
                branch={branch}
                open={renameOpen}
                onOpenChange={setRenameOpen}
            />
            <MoveDialog
                node={node}
                repoId={repoId}
                branch={branch}
                open={moveOpen}
                onOpenChange={setMoveOpen}
            />
            <PushDialog
                node={node}
                repoId={repoId}
                branch={branch}
                open={pushOpen}
                onOpenChange={setPushOpen}
            />
            <Dialog open={deleteOpen} onOpenChange={open => {
                setDeleteOpen(open);
                if (!open) setDeleteAllBranches(false);
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Node</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete &apos;{node._name}&apos; ({node._path})? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center gap-2 py-2">
                        <Checkbox
                            id={`delete-all-${node._id}`}
                            checked={deleteAllBranches}
                            onCheckedChange={checked => setDeleteAllBranches(checked === true)}
                        />
                        <Label htmlFor={`delete-all-${node._id}`} className="font-normal">
                            Delete from all branches
                        </Label>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button>Cancel</Button>
                        </DialogClose>
                        <Button
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={deleteMutation.isPending}
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

//
// * CreateNodeDialog
//

type CreateNodeDialogProps = {
    repoId: string;
    branch: string;
    parentPath: string;
};

const CreateNodeDialog = ({ repoId, branch, parentPath }: CreateNodeDialogProps): ReactElement => {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [nodeType, setNodeType] = useState('');
    const [error, setError] = useState<string | undefined>();
    const createMutation = useCreateNode();

    const handleSubmit = () => {
        if (name.trim() === '') {
            setError('Name is required');
            return;
        }
        if (name.includes('/')) {
            setError('Name cannot contain slashes');
            return;
        }

        createMutation.mutate(
            {
                repoId,
                branch,
                parentPath,
                name,
                nodeType: nodeType.trim() || undefined,
            },
            {
                onSuccess: () => {
                    toast.success(`Node '${name}' created`);
                    setOpen(false);
                    setName('');
                    setNodeType('');
                    setError(undefined);
                },
                onError: () => {
                    toast.error(`Failed to create node '${name}'`);
                },
            },
        );
    };

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            setName('');
            setNodeType('');
            setError(undefined);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="size-4" />
                    Create Node
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create Node</DialogTitle>
                    <DialogDescription>
                        Create a new child node in &apos;{parentPath}&apos;.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="create-name">Name</Label>
                        <Input
                            id="create-name"
                            value={name}
                            onChange={e => {
                                setName(e.target.value);
                                setError(undefined);
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleSubmit();
                            }}
                            placeholder="my-node"
                        />
                        {error != null && (
                            <p className="text-destructive text-sm">{error}</p>
                        )}
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="create-type">Node Type</Label>
                        <Input
                            id="create-type"
                            value={nodeType}
                            onChange={e => setNodeType(e.target.value)}
                            placeholder="default"
                        />
                    </div>
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
// * NodeBrowserPage
//

const NodeBrowserPage = (): ReactElement => {
    const { repoId, branch } = Route.useParams();
    const { path, start, count, nodeId } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

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

    const handleNodeDeleted = (deletedId: string) => {
        if (nodeId === deletedId) {
            closeNodeDetail();
        }
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
            meta: { className: 'w-35' },
            cell: info => (
                <Badge variant="secondary">{info.getValue()}</Badge>
            ),
        }),
        columnHelper.accessor('_ts', {
            header: 'Modified',
            meta: { className: 'w-45' },
            cell: info => (
                <span className="font-mono text-muted-foreground text-xs">
                    {formatTimestamp(info.getValue())}
                </span>
            ),
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            meta: { className: 'w-20' },
            cell: info => (
                <div className="flex items-center justify-end gap-1">
                    <RowActions
                        node={info.row.original}
                        repoId={repoId}
                        branch={branch}
                        onPreview={openNodeDetail}
                        onDeleted={() => handleNodeDeleted(info.row.original._id)}
                    />
                    <ChevronRight className={cn(
                        "size-4",
                        info.row.original.hasChildren
                            ? "text-muted-foreground"
                            : "invisible"
                    )} />
                </div>
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

            {/* Action toolbar */}
            <div className="flex items-center gap-2 px-4 py-2">
                <div className="flex-1" />
                <CreateNodeDialog repoId={repoId} branch={branch} parentPath={path} />
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

            <div className="flex flex-1 overflow-hidden">
                {/* Table area */}
                <div className="flex flex-1 flex-col overflow-auto">
                    <Table className="table-fixed">
                        <TableHeader>
                            {table.getHeaderGroups().map(headerGroup => (
                                <TableRow key={headerGroup.id}>
                                    {headerGroup.headers.map(header => {
                                        const meta = header.column.columnDef.meta as { className?: string } | undefined;
                                        return (
                                            <TableHead key={header.id} className={meta?.className}>
                                                {header.isPlaceholder
                                                    ? null
                                                    : flexRender(
                                                          header.column.columnDef
                                                              .header,
                                                          header.getContext(),
                                                      )}
                                            </TableHead>
                                        );
                                    })}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            <TableRow
                                className="cursor-pointer"
                                onClick={() =>
                                    isRoot
                                        ? navigate({
                                              to: '/repositories/$repoId',
                                              params: { repoId },
                                          })
                                        : navigateToPath(getParentPath(path))
                                }
                            >
                                <TableCell colSpan={columns.length}>
                                    <span className="flex min-h-8 items-center gap-2 text-muted-foreground">
                                        <ArrowLeft className="size-3.5 shrink-0" />
                                        <span className="font-mono text-[13px]">..</span>
                                    </span>
                                </TableCell>
                            </TableRow>
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
                                        {row.getVisibleCells().map(cell => {
                                            const meta = cell.column.columnDef.meta as { className?: string } | undefined;
                                            return (
                                                <TableCell key={cell.id} className={meta?.className}>
                                                    {flexRender(
                                                        cell.column.columnDef.cell,
                                                        cell.getContext(),
                                                    )}
                                                </TableCell>
                                            );
                                        })}
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                    {data.nodes.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center">
                            <EmptyState
                                icon={FolderOpen}
                                title="No nodes"
                                description="This branch has no nodes yet."
                            />
                        </div>
                    ) : (
                        data.total > 0 && (
                            <div className={cn(
                                'flex shrink-0 items-center justify-between px-4 py-3',
                                'border-border border-t',
                            )}>
                                <span className="font-mono text-muted-foreground text-xs">
                                    {start + 1}&ndash;{end} of {data.total}
                                </span>
                                <div className="flex gap-2">
                                    <Button
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
                        )
                    )}
                </div>

                {/* Inline preview panel */}
                {nodeId != null && (
                    <NodeDetailPanel
                        nodeId={nodeId}
                        repoId={repoId}
                        branch={branch}
                        onClose={closeNodeDetail}
                        onNodeMutated={closeNodeDetail}
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
