import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Copy, Ellipsis, Pencil, Plus, Send, Shield, Table2, Trash2, X } from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { createHighlighterCore } from 'shiki/core';
import langJson from 'shiki/dist/langs/json.mjs';
import themeGithubDarkDefault from 'shiki/dist/themes/github-dark-default.mjs';
import themeGithubLightDefault from 'shiki/dist/themes/github-light-default.mjs';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { branchesQueryOptions } from '../lib/api/branches';
import {
    type AccessControlEntry,
    type NodeDetail,
    type NodeDetailParams,
    nodeDetailQueryOptions,
    useCreateNode,
    useDeleteNode,
    useDuplicateNode,
    useMoveNode,
    usePushNode,
    useRenameNode,
} from '../lib/api/nodes';
import { cn } from '../lib/utils';
import { useTheme } from './theme-provider';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from './ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from './ui/select';
import { Skeleton } from './ui/skeleton';
import { toast } from './ui/sonner';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from './ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const highlighterPromise = createHighlighterCore({
    themes: [themeGithubDarkDefault, themeGithubLightDefault],
    langs: [langJson],
    engine: createJavaScriptRegexEngine(),
});

//
// * Types
//

export type NodeDetailPanelProps = {
    nodeId: string;
    repoId: string;
    branch: string;
    onClose: () => void;
    onNodeMutated?: () => void;
};

//
// * Helpers
//

const METADATA_KEYS = [
    '_id',
    '_name',
    '_path',
    '_nodeType',
    '_childOrder',
    '_ts',
    '_state',
    '_versionKey',
] as const;

const SYSTEM_KEY_PREFIX = '_';

function detectValueType(value: unknown): string {
    if (value == null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function formatValue(value: unknown): string {
    if (value == null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function formatTimestamp(ts: string): string {
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return ts;
    }
}

function resolveTheme(theme: string): 'light' | 'dark' {
    if (theme === 'dark') return 'dark';
    if (theme === 'light') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
}

//
// * PropertiesTab
//

type PropertyEntry = {
    name: string;
    type: string;
    value: string;
};

const PROPERTIES_TAB_NAME = 'PropertiesTab';

const PropertiesTab = ({ node }: { node: NodeDetail }): ReactElement => {
    const properties = useMemo<PropertyEntry[]>(() => {
        const entries: PropertyEntry[] = [];
        const keys = Object.keys(node);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (key.startsWith(SYSTEM_KEY_PREFIX)) continue;
            const value = node[key];
            entries.push({
                name: key,
                type: detectValueType(value),
                value: formatValue(value),
            });
        }
        return entries;
    }, [node]);

    if (properties.length === 0) {
        return (
            <div
                data-component={PROPERTIES_TAB_NAME}
                className="flex flex-col items-center gap-2 py-8 text-muted-foreground"
            >
                <Table2 className="size-8" />
                <p className="text-sm">No user properties</p>
            </div>
        );
    }

    return (
        <div data-component={PROPERTIES_TAB_NAME}>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Value</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {properties.map(prop => (
                        <TableRow key={prop.name}>
                            <TableCell className="font-medium">
                                {prop.name}
                            </TableCell>
                            <TableCell>
                                <Badge variant="secondary">{prop.type}</Badge>
                            </TableCell>
                            <TableCell className="max-w-[300px] truncate font-mono text-sm">
                                {prop.value}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};

PropertiesTab.displayName = PROPERTIES_TAB_NAME;

//
// * MetadataTab
//

const METADATA_TAB_NAME = 'MetadataTab';

const MetadataTab = ({ node }: { node: NodeDetail }): ReactElement => {
    return (
        <div data-component={METADATA_TAB_NAME}>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Field</TableHead>
                        <TableHead>Value</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {METADATA_KEYS.map(key => {
                        const value = node[key] as string | undefined;
                        return (
                            <TableRow key={key}>
                                <TableCell className="font-medium">
                                    {key}
                                </TableCell>
                                <TableCell className="font-mono text-sm">
                                    {key === '_nodeType' && value != null ? (
                                        <Badge variant="secondary">
                                            {value}
                                        </Badge>
                                    ) : key === '_ts' && value != null ? (
                                        formatTimestamp(value)
                                    ) : (
                                        (value ?? '—')
                                    )}
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
};

MetadataTab.displayName = METADATA_TAB_NAME;

//
// * PermissionsTab
//

const PERMISSIONS_TAB_NAME = 'PermissionsTab';

const PermissionsTab = ({
    permissions,
}: {
    permissions: AccessControlEntry[];
}): ReactElement => {
    if (permissions.length === 0) {
        return (
            <div
                data-component={PERMISSIONS_TAB_NAME}
                className="flex flex-col items-center gap-2 py-8 text-muted-foreground"
            >
                <Shield className="size-8" />
                <p className="text-sm">No permissions defined</p>
            </div>
        );
    }

    return (
        <div data-component={PERMISSIONS_TAB_NAME}>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Principal</TableHead>
                        <TableHead>Allow</TableHead>
                        <TableHead>Deny</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {permissions.map(entry => (
                        <TableRow key={entry.principal}>
                            <TableCell className="font-medium">
                                {entry.principal}
                            </TableCell>
                            <TableCell>
                                <div className="flex flex-wrap gap-1">
                                    {entry.allow.map(perm => (
                                        <Badge
                                            key={perm}
                                            variant="secondary"
                                        >
                                            {perm}
                                        </Badge>
                                    ))}
                                </div>
                            </TableCell>
                            <TableCell>
                                <div className="flex flex-wrap gap-1">
                                    {entry.deny.map(perm => (
                                        <Badge
                                            key={perm}
                                            variant="destructive"
                                        >
                                            {perm}
                                        </Badge>
                                    ))}
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};

PermissionsTab.displayName = PERMISSIONS_TAB_NAME;

//
// * JsonTab
//

const JSON_TAB_NAME = 'JsonTab';

const JsonTab = ({ node }: { node: NodeDetail }): ReactElement => {
    const { theme } = useTheme();
    const [html, setHtml] = useState<string>('');
    const json = useMemo(() => JSON.stringify(node, null, 2), [node]);

    useEffect(() => {
        let cancelled = false;
        const shikiTheme =
            resolveTheme(theme) === 'dark'
                ? 'github-dark-default'
                : 'github-light-default';

        highlighterPromise.then(hl => {
            if (!cancelled) {
                setHtml(hl.codeToHtml(json, { lang: 'json', theme: shikiTheme }));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [json, theme]);

    if (html === '') {
        return (
            <div data-component={JSON_TAB_NAME} className="space-y-2 py-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
            </div>
        );
    }

    return (
        <div
            data-component={JSON_TAB_NAME}
            className="[&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:p-4 [&_pre]:text-sm"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki produces safe HTML from JSON data
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
};

JsonTab.displayName = JSON_TAB_NAME;

//
// * PanelActions
//

type PanelActionsProps = {
    node: NodeDetail;
    repoId: string;
    branch: string;
    onNodeMutated?: () => void;
};

const PanelActions = ({ node, repoId, branch, onNodeMutated }: PanelActionsProps): ReactElement => {
    const [createOpen, setCreateOpen] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);
    const [pushOpen, setPushOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteAllBranches, setDeleteAllBranches] = useState(false);

    const [createName, setCreateName] = useState('');
    const [createType, setCreateType] = useState('');
    const [createError, setCreateError] = useState<string | undefined>();
    const [renameName, setRenameName] = useState(node._name);
    const [renameError, setRenameError] = useState<string | undefined>();
    const [movePath, setMovePath] = useState('');
    const [moveError, setMoveError] = useState<string | undefined>();
    const [pushTarget, setPushTarget] = useState('');
    const [pushChildren, setPushChildren] = useState(false);
    const [pushResolve, setPushResolve] = useState(true);

    const createMutation = useCreateNode();
    const renameMutation = useRenameNode();
    const moveMutation = useMoveNode();
    const pushMutation = usePushNode();
    const duplicateMutation = useDuplicateNode();
    const deleteMutation = useDeleteNode();

    const { data: branches } = useQuery(branchesQueryOptions(repoId));
    const availableBranches = branches?.filter(b => b.id !== branch) ?? [];

    const isRoot = node._path === '/';

    const handleDuplicate = () => {
        duplicateMutation.mutate(
            { repoId, branch, nodeId: node._id },
            {
                onSuccess: (result) => {
                    toast.success(`Node duplicated as '${result._name}'`);
                },
                onError: () => toast.error(`Failed to duplicate node '${node._name}'`),
            },
        );
    };

    const handleCreate = () => {
        if (createName.trim() === '') {
            setCreateError('Name is required');
            return;
        }
        if (createName.includes('/')) {
            setCreateError('Name cannot contain slashes');
            return;
        }
        createMutation.mutate(
            { repoId, branch, parentPath: node._path, name: createName, nodeType: createType.trim() || undefined },
            {
                onSuccess: () => {
                    toast.success(`Node '${createName}' created`);
                    setCreateOpen(false);
                    setCreateName('');
                    setCreateType('');
                    setCreateError(undefined);
                },
                onError: () => toast.error(`Failed to create node '${createName}'`),
            },
        );
    };

    const handleRename = () => {
        if (renameName.trim() === '') {
            setRenameError('Name is required');
            return;
        }
        if (renameName.includes('/')) {
            setRenameError('Name cannot contain slashes');
            return;
        }
        if (renameName === node._name) {
            setRenameError('Name must be different from current');
            return;
        }
        renameMutation.mutate(
            { repoId, branch, key: node._id, newName: renameName },
            {
                onSuccess: () => {
                    toast.success(`Node renamed to '${renameName}'`);
                    setRenameOpen(false);
                },
                onError: () => toast.error('Failed to rename node'),
            },
        );
    };

    const handleMove = () => {
        if (movePath.trim() === '') {
            setMoveError('Target path is required');
            return;
        }
        if (!movePath.startsWith('/')) {
            setMoveError('Path must start with /');
            return;
        }
        moveMutation.mutate(
            { repoId, branch, key: node._id, targetPath: movePath },
            {
                onSuccess: () => {
                    toast.success(`Node moved to '${movePath}'`);
                    setMoveOpen(false);
                    onNodeMutated?.();
                },
                onError: () => toast.error('Failed to move node'),
            },
        );
    };

    const handlePush = () => {
        if (pushTarget === '') return;
        pushMutation.mutate(
            { repoId, branch, key: node._id, target: pushTarget, includeChildren: pushChildren, resolve: pushResolve },
            {
                onSuccess: (result) => {
                    const failedCount = result.failed.length;
                    if (failedCount > 0) {
                        toast.warning(`Pushed to '${pushTarget}': ${result.success.length} succeeded, ${failedCount} failed`);
                    } else {
                        toast.success(`Pushed to '${pushTarget}': ${result.success.length} nodes`);
                    }
                    setPushOpen(false);
                },
                onError: () => toast.error('Failed to push node'),
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
                    onNodeMutated?.();
                },
                onError: () => toast.error(`Failed to delete node '${node._name}'`),
            },
        );
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className={cn(
                            'ml-1 flex size-7 shrink-0 items-center justify-center rounded-md',
                            'text-muted-foreground transition-colors',
                            'hover:bg-accent hover:text-accent-foreground',
                        )}
                        aria-label="Node actions"
                    >
                        <Ellipsis className="size-4" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                            <Plus className="size-4" />
                            Create Child
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem disabled={isRoot} onClick={() => {
                            setRenameName(node._name);
                            setRenameOpen(true);
                        }}>
                            <Pencil className="size-4" />
                            Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={isRoot} onClick={() => setMoveOpen(true)}>
                            <ArrowRightLeft className="size-4" />
                            Move
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDuplicate}>
                            <Copy className="size-4" />
                            Duplicate
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => setPushOpen(true)}>
                            <Send className="size-4" />
                            Push
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                        <DropdownMenuItem
                            disabled={isRoot}
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteOpen(true)}
                        >
                            <Trash2 className="size-4" />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Create Child Dialog */}
            <Dialog open={createOpen} onOpenChange={open => {
                setCreateOpen(open);
                if (!open) { setCreateName(''); setCreateType(''); setCreateError(undefined); }
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create Child Node</DialogTitle>
                        <DialogDescription>
                            Create a new child node under &apos;{node._path}&apos;.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="panel-create-name">Name</Label>
                            <Input
                                id="panel-create-name"
                                value={createName}
                                onChange={e => { setCreateName(e.target.value); setCreateError(undefined); }}
                                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                                placeholder="my-node"
                            />
                            {createError != null && <p className="text-destructive text-sm">{createError}</p>}
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="panel-create-type">Node Type</Label>
                            <Input
                                id="panel-create-type"
                                value={createType}
                                onChange={e => setCreateType(e.target.value)}
                                placeholder="default"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button>Cancel</Button></DialogClose>
                        <Button variant="primary" onClick={handleCreate} disabled={createMutation.isPending}>Create</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Rename Dialog */}
            <Dialog open={renameOpen} onOpenChange={open => {
                setRenameOpen(open);
                if (!open) { setRenameName(node._name); setRenameError(undefined); }
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rename Node</DialogTitle>
                        <DialogDescription>Enter a new name for &apos;{node._name}&apos;.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2 py-4">
                        <Label htmlFor="panel-rename-name">Name</Label>
                        <Input
                            id="panel-rename-name"
                            value={renameName}
                            onChange={e => { setRenameName(e.target.value); setRenameError(undefined); }}
                            onKeyDown={e => { if (e.key === 'Enter') handleRename(); }}
                        />
                        {renameError != null && <p className="text-destructive text-sm">{renameError}</p>}
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button>Cancel</Button></DialogClose>
                        <Button variant="primary" onClick={handleRename} disabled={renameMutation.isPending}>Rename</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Move Dialog */}
            <Dialog open={moveOpen} onOpenChange={open => {
                setMoveOpen(open);
                if (!open) { setMovePath(''); setMoveError(undefined); }
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Move Node</DialogTitle>
                        <DialogDescription>Move &apos;{node._name}&apos; to a new parent path.</DialogDescription>
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
                            <Label htmlFor="panel-move-path">Target Path</Label>
                            <Input
                                id="panel-move-path"
                                value={movePath}
                                onChange={e => { setMovePath(e.target.value); setMoveError(undefined); }}
                                onKeyDown={e => { if (e.key === 'Enter') handleMove(); }}
                                placeholder="/target/path"
                            />
                            {moveError != null && <p className="text-destructive text-sm">{moveError}</p>}
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button>Cancel</Button></DialogClose>
                        <Button variant="primary" onClick={handleMove} disabled={moveMutation.isPending}>Move</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Push Dialog */}
            <Dialog open={pushOpen} onOpenChange={open => {
                setPushOpen(open);
                if (!open) { setPushTarget(''); setPushChildren(false); setPushResolve(true); }
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Push Node</DialogTitle>
                        <DialogDescription>Push &apos;{node._name}&apos; to another branch.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Target Branch</Label>
                            <Select value={pushTarget} onValueChange={setPushTarget}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select branch" />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableBranches.map(b => (
                                        <SelectItem key={b.id} value={b.id}>{b.id}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox id="panel-push-children" checked={pushChildren} onCheckedChange={checked => setPushChildren(checked === true)} />
                            <Label htmlFor="panel-push-children" className="font-normal">Include children</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Checkbox id="panel-push-resolve" checked={pushResolve} onCheckedChange={checked => setPushResolve(checked === true)} />
                            <Label htmlFor="panel-push-resolve" className="font-normal">Resolve dependencies</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button>Cancel</Button></DialogClose>
                        <Button variant="primary" onClick={handlePush} disabled={pushMutation.isPending || pushTarget === ''}>Push</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirm */}
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
                            id="panel-delete-all"
                            checked={deleteAllBranches}
                            onCheckedChange={checked => setDeleteAllBranches(checked === true)}
                        />
                        <Label htmlFor="panel-delete-all" className="font-normal">
                            Delete from all branches
                        </Label>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button>Cancel</Button></DialogClose>
                        <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

//
// * NodeDetailContent
//

const NODE_DETAIL_CONTENT_NAME = 'NodeDetailContent';

const NodeDetailContent = ({
    params,
    onClose,
    onNodeMutated,
}: {
    params: NodeDetailParams;
    onClose: () => void;
    onNodeMutated?: () => void;
}): ReactElement => {
    const { data: node, isLoading, error } = useQuery(nodeDetailQueryOptions(params));

    if (isLoading) {
        return (
            <div
                data-component={NODE_DETAIL_CONTENT_NAME}
                className="space-y-4 p-4"
            >
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-32 w-full" />
            </div>
        );
    }

    if (error != null || node == null) {
        return (
            <div
                data-component={NODE_DETAIL_CONTENT_NAME}
                className="py-8 text-center text-destructive text-sm"
            >
                Failed to load node details.
            </div>
        );
    }

    return (
        <div data-component={NODE_DETAIL_CONTENT_NAME} className="flex h-full flex-col">
            {/* Panel header */}
            <div className="flex shrink-0 items-start justify-between border-border border-b p-4">
                <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-[15px] text-foreground">
                        {node._name}
                    </h3>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {node._path}
                    </p>
                </div>
                <div className="flex shrink-0 items-center">
                    <PanelActions
                        node={node}
                        repoId={params.repoId}
                        branch={params.branch}
                        onNodeMutated={onNodeMutated}
                    />
                    <button
                        type="button"
                        onClick={onClose}
                        className={cn(
                            'ml-1 flex size-7 shrink-0 items-center justify-center rounded-md',
                            'text-muted-foreground transition-colors',
                            'hover:bg-accent hover:text-accent-foreground',
                        )}
                        aria-label="Close panel"
                    >
                        <X className="size-4" />
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="properties" className="flex flex-1 flex-col overflow-hidden">
                <TabsList className="mx-4 mt-2 w-auto">
                    <TabsTrigger value="properties">Properties</TabsTrigger>
                    <TabsTrigger value="metadata">Metadata</TabsTrigger>
                    <TabsTrigger value="permissions">Permissions</TabsTrigger>
                    <TabsTrigger value="json">JSON</TabsTrigger>
                </TabsList>
                <div className="flex-1 overflow-auto">
                    <TabsContent value="properties">
                        <PropertiesTab node={node} />
                    </TabsContent>
                    <TabsContent value="metadata">
                        <MetadataTab node={node} />
                    </TabsContent>
                    <TabsContent value="permissions">
                        <PermissionsTab
                            permissions={node._permissions ?? []}
                        />
                    </TabsContent>
                    <TabsContent value="json">
                        <JsonTab node={node} />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
};

NodeDetailContent.displayName = NODE_DETAIL_CONTENT_NAME;

//
// * NodeDetailPanel
//

const NODE_DETAIL_PANEL_NAME = 'NodeDetailPanel';

export const NodeDetailPanel = ({
    nodeId,
    repoId,
    branch,
    onClose,
    onNodeMutated,
}: NodeDetailPanelProps): ReactElement => {
    return (
        <div
            data-component={NODE_DETAIL_PANEL_NAME}
            className="flex w-[400px] shrink-0 flex-col border-border border-l bg-card"
        >
            <NodeDetailContent
                params={{ repoId, branch, key: nodeId }}
                onClose={onClose}
                onNodeMutated={onNodeMutated}
            />
        </div>
    );
};

NodeDetailPanel.displayName = NODE_DETAIL_PANEL_NAME;
