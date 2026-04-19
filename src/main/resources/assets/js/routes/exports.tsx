import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import {
    Download,
    Ellipsis,
    FileOutput,
    Import,
    Plus,
    Trash2,
    Upload,
} from 'lucide-react';
import type { ChangeEvent, ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
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
import { Progress } from '../components/ui/progress';
import { ProgressDialog } from '../components/ui/progress-dialog';
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
import {
    type ExportEntry,
    exportsQueryOptions,
    getExportDownloadUrl,
    useCreateExport,
    useDeleteExport,
    useImportExport,
    useUploadExport,
} from '../lib/api/exports';
import { type Repository, repositoriesQueryOptions } from '../lib/api/repositories';
import { type TaskInfo, type TaskState, taskQueryOptions } from '../lib/api/tasks';
import { useTaskProgress } from '../lib/hooks/use-task-progress';

const EXPORTS_PAGE_NAME = 'ExportsPage';

const exportNameSchema = z
    .string()
    .min(3, 'Must be at least 3 characters')
    .max(100, 'Must be at most 100 characters')
    .regex(
        /^[A-Za-z0-9][A-Za-z0-9._-]{1,98}[A-Za-z0-9]$/,
        'Must contain only letters, digits, dots, hyphens, and underscores',
    );

//
// * Helpers
//

function formatTimestamp(timestamp: string): string {
    if (timestamp === '') return '\u2014';
    try {
        return new Date(timestamp).toLocaleString();
    } catch {
        return timestamp;
    }
}

function formatDateSuffix(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function generateExportName(repositoryId?: string, branch?: string): string {
    const dateSuffix = formatDateSuffix();
    if (repositoryId != null && branch != null) {
        return `${repositoryId}-${branch}-${dateSuffix}`;
    }
    return `export-${dateSuffix}`;
}

type ActiveTask = {
    id: string;
    type: 'create' | 'import';
    name?: string;
};

type ExportResult = {
    exportedNodes: string[];
    exportedBinaries: string[];
    exportErrors: { message: string }[];
};

type ImportResult = {
    addedNodes: string[];
    updatedNodes: string[];
    importedBinaries: string[];
    importErrors: { message: string }[];
};

function parseExportResult(info: string): ExportResult | undefined {
    try {
        const parsed = JSON.parse(info);
        if (parsed?.exportedNodes != null) return parsed as ExportResult;
        return undefined;
    } catch {
        return undefined;
    }
}

function parseImportResult(info: string): ImportResult | undefined {
    try {
        const parsed = JSON.parse(info);
        if (parsed?.addedNodes != null) return parsed as ImportResult;
        return undefined;
    } catch {
        return undefined;
    }
}

const TERMINAL_STATES: TaskState[] = ['FINISHED', 'FAILED'];

const TASK_TYPE_LABELS: Record<ActiveTask['type'], string> = {
    create: 'Exporting nodes',
    import: 'Importing nodes',
};

const TASK_COMPLETE_LABELS: Record<ActiveTask['type'], string> = {
    create: 'Export completed',
    import: 'Import completed',
};

const columnHelper = createColumnHelper<ExportEntry>();

function getProgress(task: TaskInfo | undefined): number {
    if (task == null) return 0;
    if (task.state === 'FINISHED') return 100;
    if (task.progress.total > 0) {
        return Math.round((task.progress.current / task.progress.total) * 100);
    }
    return 0;
}

// ? Number of visible columns: Name, Timestamp, Format, Nodes, Actions
const COLUMN_COUNT = 5;

//
// * ExportResultSummary
//

const ExportResultSummary = ({ result }: { result: ExportResult }): ReactElement => {
    const nodeCount = result.exportedNodes.length;
    const binaryCount = result.exportedBinaries.length;
    const errorCount = result.exportErrors.length;

    return (
        <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
                {nodeCount} nodes exported, {binaryCount} binaries
                {errorCount > 0 && (
                    <span className="text-destructive"> ({errorCount} errors)</span>
                )}
            </p>
            {errorCount > 0 && (
                <div className="max-h-32 overflow-y-auto">
                    {result.exportErrors.map((err) => (
                        <p key={err.message} className="text-destructive text-xs">{err.message}</p>
                    ))}
                </div>
            )}
        </div>
    );
};

ExportResultSummary.displayName = 'ExportResultSummary';

//
// * ImportResultSummary
//

const ImportResultSummary = ({ result }: { result: ImportResult }): ReactElement => {
    const addedCount = result.addedNodes.length;
    const updatedCount = result.updatedNodes.length;
    const binaryCount = result.importedBinaries.length;
    const errorCount = result.importErrors.length;

    return (
        <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
                {addedCount} added, {updatedCount} updated, {binaryCount} binaries
                {errorCount > 0 && (
                    <span className="text-destructive"> ({errorCount} errors)</span>
                )}
            </p>
            {errorCount > 0 && (
                <div className="max-h-32 overflow-y-auto">
                    {result.importErrors.map((err) => (
                        <p key={err.message} className="text-destructive text-xs">{err.message}</p>
                    ))}
                </div>
            )}
        </div>
    );
};

ImportResultSummary.displayName = 'ImportResultSummary';

//
// * RowActions
//

type RowActionsProps = {
    exportEntry: ExportEntry;
};

const RowActions = ({ exportEntry }: RowActionsProps): ReactElement => {
    const [deleteOpen, setDeleteOpen] = useState(false);
    const deleteMutation = useDeleteExport();

    const handleDelete = () => {
        deleteMutation.mutate(exportEntry.name, {
            onSuccess: () => {
                toast.success(`Export '${exportEntry.name}' deleted`);
                setDeleteOpen(false);
            },
            onError: () => {
                toast.error(`Failed to delete export '${exportEntry.name}'`);
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
                                window.open(getExportDownloadUrl(exportEntry.name), '_blank');
                            }}
                        >
                            <Download className="size-4" />
                            Download
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
                title="Delete Export"
                description={`Are you sure you want to delete '${exportEntry.name}'? This action cannot be undone.`}
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
// * CreateExportDialog
//

type CreateExportDialogProps = {
    repositories: Repository[];
    onStartTask: (task: ActiveTask) => void;
};

const CreateExportDialog = ({ repositories, onStartTask }: CreateExportDialogProps): ReactElement => {
    const [open, setOpen] = useState(false);
    const [repositoryId, setRepositoryId] = useState('');
    const [branch, setBranch] = useState('');
    const [nodePath, setNodePath] = useState('/content');
    const [exportName, setExportName] = useState('');
    const [nameEdited, setNameEdited] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);
    const createMutation = useCreateExport();

    const selectedRepo = repositories.find(r => r.id === repositoryId);
    const branches = selectedRepo?.branches ?? [];

    const handleSubmit = () => {
        const parsed = exportNameSchema.safeParse(exportName.trim());
        if (!parsed.success) {
            setNameError(parsed.error.issues[0].message);
            return;
        }
        if (repositoryId === '' || branch === '' || nodePath.trim() === '') return;

        const name = parsed.data;
        createMutation.mutate(
            {
                exportName: name,
                repositoryId,
                branch,
                nodePath: nodePath.trim(),
            },
            {
                onSuccess: (result) => {
                    setOpen(false);
                    resetForm();
                    onStartTask({ id: result.taskId, type: 'create', name });
                },
                onError: () => {
                    toast.error('Failed to start export');
                },
            },
        );
    };

    const resetForm = () => {
        setRepositoryId('');
        setBranch('');
        setNodePath('/content');
        setExportName('');
        setNameEdited(false);
        setNameError(null);
    };

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (nextOpen) {
            setExportName(generateExportName());
        } else {
            resetForm();
        }
    };

    const handleRepositoryChange = (value: string) => {
        setRepositoryId(value);
        setBranch('');
        if (!nameEdited) {
            setExportName(generateExportName(value));
        }
    };

    const handleBranchChange = (value: string) => {
        setBranch(value);
        if (!nameEdited) {
            setExportName(generateExportName(repositoryId, value));
        }
    };

    const handleNameChange = (value: string) => {
        setExportName(value);
        setNameEdited(true);
        if (nameError != null) setNameError(null);
    };

    const isValid = exportName.trim() !== '' && repositoryId !== '' && branch !== '' && nodePath.trim() !== '';

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="size-4" />
                    Create Export
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create Export</DialogTitle>
                    <DialogDescription>
                        Export a node subtree from a repository branch.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="export-repo">Repository</Label>
                        <Select value={repositoryId} onValueChange={handleRepositoryChange}>
                            <SelectTrigger id="export-repo">
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
                    <div className="grid gap-2">
                        <Label htmlFor="export-branch">Branch</Label>
                        <Select value={branch} onValueChange={handleBranchChange} disabled={repositoryId === ''}>
                            <SelectTrigger id="export-branch">
                                <SelectValue placeholder="Select a branch" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map(b => (
                                    <SelectItem key={b} value={b}>
                                        {b}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="export-node-path">Node path</Label>
                        <Input
                            id="export-node-path"
                            value={nodePath}
                            onChange={e => setNodePath(e.target.value)}
                            placeholder="/content"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="export-name">Export name</Label>
                        <Input
                            id="export-name"
                            value={exportName}
                            onChange={e => handleNameChange(e.target.value)}
                            placeholder="my-export"
                        />
                        {nameError != null && (
                            <p className="text-destructive text-sm">{nameError}</p>
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
                        disabled={!isValid || createMutation.isPending}
                    >
                        Export
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

//
// * ImportDialog
//

type ImportDialogProps = {
    exports: ExportEntry[];
    repositories: Repository[];
    onStartTask: (task: ActiveTask) => void;
};

const ImportDialog = ({ exports, repositories, onStartTask }: ImportDialogProps): ReactElement => {
    const [open, setOpen] = useState(false);
    const [exportName, setExportName] = useState('');
    const [repositoryId, setRepositoryId] = useState('');
    const [branch, setBranch] = useState('');
    const [targetNodePath, setTargetNodePath] = useState('/content');
    const [includeNodeIds, setIncludeNodeIds] = useState(true);
    const [includePermissions, setIncludePermissions] = useState(true);
    const importMutation = useImportExport();

    const selectedRepo = repositories.find(r => r.id === repositoryId);
    const branches = selectedRepo?.branches ?? [];

    const handleSubmit = () => {
        if (exportName === '' || repositoryId === '' || branch === '' || targetNodePath.trim() === '') return;

        importMutation.mutate(
            {
                exportName,
                repositoryId,
                branch,
                targetNodePath: targetNodePath.trim(),
                includeNodeIds,
                includePermissions,
            },
            {
                onSuccess: (result) => {
                    setOpen(false);
                    resetForm();
                    onStartTask({ id: result.taskId, type: 'import' });
                },
                onError: () => {
                    toast.error('Failed to start import');
                },
            },
        );
    };

    const resetForm = () => {
        setExportName('');
        setRepositoryId('');
        setBranch('');
        setTargetNodePath('/content');
        setIncludeNodeIds(true);
        setIncludePermissions(true);
    };

    const handleOpenChange = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            resetForm();
        }
    };

    const handleRepositoryChange = (value: string) => {
        setRepositoryId(value);
        setBranch('');
    };

    const isValid = exportName !== '' && repositoryId !== '' && branch !== '' && targetNodePath.trim() !== '';

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button>
                    <Import className="size-4" />
                    Import
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Import Export</DialogTitle>
                    <DialogDescription>
                        Import an existing export into a repository branch.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="import-export">Export</Label>
                        <Select value={exportName} onValueChange={setExportName}>
                            <SelectTrigger id="import-export">
                                <SelectValue placeholder="Select an export" />
                            </SelectTrigger>
                            <SelectContent>
                                {exports.map(exp => (
                                    <SelectItem key={exp.name} value={exp.name}>
                                        {exp.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="import-repo">Repository</Label>
                        <Select value={repositoryId} onValueChange={handleRepositoryChange}>
                            <SelectTrigger id="import-repo">
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
                    <div className="grid gap-2">
                        <Label htmlFor="import-branch">Branch</Label>
                        <Select value={branch} onValueChange={setBranch} disabled={repositoryId === ''}>
                            <SelectTrigger id="import-branch">
                                <SelectValue placeholder="Select a branch" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map(b => (
                                    <SelectItem key={b} value={b}>
                                        {b}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="import-target-path">Target path</Label>
                        <Input
                            id="import-target-path"
                            value={targetNodePath}
                            onChange={e => setTargetNodePath(e.target.value)}
                            placeholder="/content"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="import-node-ids"
                            checked={includeNodeIds}
                            onCheckedChange={checked => setIncludeNodeIds(checked === true)}
                        />
                        <Label htmlFor="import-node-ids">Include node IDs</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="import-permissions"
                            checked={includePermissions}
                            onCheckedChange={checked => setIncludePermissions(checked === true)}
                        />
                        <Label htmlFor="import-permissions">Include permissions</Label>
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button>Cancel</Button>
                    </DialogClose>
                    <Button
                        variant="primary"
                        onClick={handleSubmit}
                        disabled={!isValid || importMutation.isPending}
                    >
                        Import
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

//
// * UploadExportDialog
//

const UploadExportDialog = (): ReactElement => {
    const [open, setOpen] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadMutation = useUploadExport();

    const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file == null) return;

        setUploadProgress(0);
        uploadMutation.mutate({ file, onProgress: setUploadProgress }, {
            onSuccess: () => {
                const displayName = file.name.endsWith('.zip') ? file.name.slice(0, -4) : file.name;
                toast.success(`Export '${displayName}' uploaded`);
                setOpen(false);
                setUploadProgress(0);
            },
            onError: (error) => {
                const message = (error as { message?: string })?.message ?? 'Upload failed';
                toast.error(message);
                setUploadProgress(0);
            },
        });

        if (fileInputRef.current != null) {
            fileInputRef.current.value = '';
        }
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (uploadMutation.isPending) return;
        setOpen(nextOpen);
        if (!nextOpen) {
            setUploadProgress(0);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button>
                    <Upload className="size-4" />
                    Upload
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Upload Export</DialogTitle>
                    <DialogDescription>
                        Upload a ZIP archive containing an export.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".zip"
                        className="hidden"
                        onChange={handleFileSelect}
                    />
                    <Button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadMutation.isPending}
                    >
                        Select ZIP file
                    </Button>
                    {uploadMutation.isPending && (
                        <div className="flex items-center gap-2">
                            <Progress value={uploadProgress} className="h-2 flex-1" />
                            <span className="whitespace-nowrap text-muted-foreground text-xs">
                                {uploadProgress}%
                            </span>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button disabled={uploadMutation.isPending}>Close</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

//
// * ExportsPage
//

const ExportsPage = (): ReactElement => {
    const { data: exports } = useSuspenseQuery(exportsQueryOptions());
    const { data: repositories } = useSuspenseQuery(repositoriesQueryOptions());
    const [activeTask, setActiveTask] = useState<ActiveTask | undefined>(undefined);
    const [dialogOpen, setDialogOpen] = useState(false);
    const queryClient = useQueryClient();
    const handledRef = useRef(false);

    const { data: task } = useQuery(taskQueryOptions(activeTask?.id));
    useTaskProgress(activeTask?.id);

    const isTaskTerminal = task != null && TERMINAL_STATES.includes(task.state);
    const isTaskRunning = activeTask != null && !isTaskTerminal;
    const isCreating = activeTask?.type === 'create' && !isTaskTerminal;
    const progress = getProgress(task);

    // ? Handle task completion once when terminal state is first reached
    useEffect(() => {
        if (!isTaskTerminal || handledRef.current) return;
        handledRef.current = true;
        queryClient.invalidateQueries({ queryKey: ['exports'] });
    }, [isTaskTerminal, queryClient]);

    const handleStartTask = (newTask: ActiveTask) => {
        setActiveTask(newTask);
        setDialogOpen(true);
        handledRef.current = false;
    };

    const handleDialogClose = () => {
        setDialogOpen(false);
        if (isTaskTerminal) {
            setActiveTask(undefined);
            handledRef.current = false;
        }
    };

    const columns = [
        columnHelper.accessor('name', {
            header: 'Name',
            cell: info => info.getValue(),
        }),
        columnHelper.accessor('timestamp', {
            header: 'Timestamp',
            cell: info => formatTimestamp(info.getValue()),
        }),
        columnHelper.accessor('format', {
            header: 'Format',
            cell: info => info.getValue(),
        }),
        columnHelper.accessor('nodeCount', {
            header: 'Nodes',
            cell: info => {
                const count = info.getValue();
                return count < 0 ? '\u2014' : count;
            },
        }),
        columnHelper.display({
            id: 'actions',
            header: '',
            cell: info => (
                <div className="flex items-center justify-end gap-1">
                    <RowActions exportEntry={info.row.original} />
                </div>
            ),
        }),
    ];

    const table = useReactTable({
        data: exports,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    return (
        <div data-component={EXPORTS_PAGE_NAME} className="flex flex-col">
            {/* Breadcrumb bar */}
            <div className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-border border-b bg-card px-4">
                <span className="font-medium font-mono text-foreground text-xs">Exports</span>
            </div>

            {/* Action toolbar */}
            <div className="flex items-center gap-2 px-4 py-2">
                <div className="flex-1" />
                <UploadExportDialog />
                <ImportDialog exports={exports} repositories={repositories} onStartTask={handleStartTask} />
                <CreateExportDialog repositories={repositories} onStartTask={handleStartTask} />
            </div>

            {exports.length === 0 && !isCreating ? (
                <EmptyState
                    icon={FileOutput}
                    title="No exports"
                    description="No exports found. Create one to get started."
                    action={<CreateExportDialog repositories={repositories} onStartTask={handleStartTask} />}
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
                                                  header.column.columnDef.header,
                                                  header.getContext(),
                                              )}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {isCreating && (
                            <TableRow>
                                <TableCell className="font-medium">{activeTask?.name}</TableCell>
                                <TableCell colSpan={COLUMN_COUNT - 2}>
                                    <div className="flex items-center gap-2">
                                        <Progress value={progress} className="h-2 flex-1" />
                                        <span className="whitespace-nowrap text-muted-foreground text-xs">
                                            {Math.round(progress)}%
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell />
                            </TableRow>
                        )}
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

            {/* Non-dismissable progress dialog while task is running */}
            {isTaskRunning && (
                <ProgressDialog
                    title={TASK_TYPE_LABELS[activeTask.type]}
                    description={task?.progress.info || 'Starting...'}
                    progress={progress}
                    open={dialogOpen}
                />
            )}

            {/* Completion dialog — dismissable */}
            {activeTask != null && isTaskTerminal && (
                <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleDialogClose(); }}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>
                                {task?.state === 'FINISHED'
                                    ? TASK_COMPLETE_LABELS[activeTask.type]
                                    : 'Operation failed'}
                            </DialogTitle>
                        </DialogHeader>
                        {task?.state === 'FINISHED' && (() => {
                            if (activeTask.type === 'create') {
                                const result = parseExportResult(task.progress.info);
                                if (result != null) return <ExportResultSummary result={result} />;
                            }
                            if (activeTask.type === 'import') {
                                const result = parseImportResult(task.progress.info);
                                if (result != null) return <ImportResultSummary result={result} />;
                            }
                            return (
                                <p className="text-muted-foreground text-sm">
                                    {task.progress.info || 'Operation completed successfully.'}
                                </p>
                            );
                        })()}
                        {task?.state === 'FAILED' && (
                            <p className="text-destructive text-sm">
                                {task.progress.info || 'Operation failed.'}
                            </p>
                        )}
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button>Close</Button>
                            </DialogClose>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
};

ExportsPage.displayName = EXPORTS_PAGE_NAME;

export const Route = createFileRoute('/exports')({
    loader: ({ context: { queryClient } }) =>
        Promise.all([
            queryClient.ensureQueryData(exportsQueryOptions()),
            queryClient.ensureQueryData(repositoriesQueryOptions()),
        ]),
    component: ExportsPage,
});
