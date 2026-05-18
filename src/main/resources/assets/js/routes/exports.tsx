import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Download, Ellipsis, FileOutput, Import, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import type { ChangeEvent, ReactElement } from 'react';

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
import { getProgress, TERMINAL_STATES, taskQueryOptions } from '../lib/api/tasks';
import { useTaskProgress } from '../lib/hooks/use-task-progress';

const EXPORTS_PAGE_NAME = 'ExportsPage';

const exportNameSchema = z
  .string()
  .min(3, 'export.error.tooShort')
  .max(100, 'export.error.tooLong')
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,98}[A-Za-z0-9]$/, 'export.error.invalidChars');

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

const TASK_TYPE_KEYS: Record<ActiveTask['type'], string> = {
  create: 'export.task.exporting',
  import: 'export.task.importing',
};

const TASK_COMPLETE_KEYS: Record<ActiveTask['type'], string> = {
  create: 'export.task.exportCompleted',
  import: 'export.task.importCompleted',
};

const columnHelper = createColumnHelper<ExportEntry>();

// ? Number of visible columns: Name, Timestamp, Format, Nodes, Actions
const COLUMN_COUNT = 5;

//
// * ExportResultSummary
//

const ExportResultSummary = ({ result }: { result: ExportResult }): ReactElement => {
  const { t } = useTranslation();
  const nodeCount = result.exportedNodes.length;
  const binaryCount = result.exportedBinaries.length;
  const errorCount = result.exportErrors.length;

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        {t('export.result.summary', { nodes: nodeCount, binaries: binaryCount })}
        {errorCount > 0 && (
          <span className="text-destructive">
            {' '}
            {t('dump.result.errors', { count: errorCount })}
          </span>
        )}
      </p>
      {errorCount > 0 && (
        <div className="max-h-32 overflow-y-auto">
          {result.exportErrors.map((err) => (
            <p key={err.message} className="text-destructive text-xs">
              {err.message}
            </p>
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
  const { t } = useTranslation();
  const addedCount = result.addedNodes.length;
  const updatedCount = result.updatedNodes.length;
  const binaryCount = result.importedBinaries.length;
  const errorCount = result.importErrors.length;

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        {t('export.result.importSummary', {
          added: addedCount,
          updated: updatedCount,
          binaries: binaryCount,
        })}
        {errorCount > 0 && (
          <span className="text-destructive">
            {' '}
            {t('dump.result.errors', { count: errorCount })}
          </span>
        )}
      </p>
      {errorCount > 0 && (
        <div className="max-h-32 overflow-y-auto">
          {result.importErrors.map((err) => (
            <p key={err.message} className="text-destructive text-xs">
              {err.message}
            </p>
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
  const { t } = useTranslation();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMutation = useDeleteExport();

  const handleDelete = () => {
    deleteMutation.mutate(exportEntry.name, {
      onSuccess: () => {
        toast.success(t('export.toast.deleted', { name: exportEntry.name }));
        setDeleteOpen(false);
      },
      onError: () => {
        toast.error(t('export.toast.deleteFailed', { name: exportEntry.name }));
      },
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
            <Ellipsis className="text-muted-foreground size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                window.open(getExportDownloadUrl(exportEntry.name), '_blank');
              }}
            >
              <Download className="size-4" />
              {t('common.action.download')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={(e) => {
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
        title={t('export.dialog.delete.title')}
        description={t('export.dialog.delete.description', { name: exportEntry.name })}
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
// * CreateExportDialog
//

type CreateExportDialogProps = {
  repositories: Repository[];
  onStartTask: (task: ActiveTask) => void;
};

const CreateExportDialog = ({
  repositories,
  onStartTask,
}: CreateExportDialogProps): ReactElement => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [repositoryId, setRepositoryId] = useState('');
  const [branch, setBranch] = useState('');
  const [nodePath, setNodePath] = useState('/content');
  const [exportName, setExportName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const createMutation = useCreateExport();

  const selectedRepo = repositories.find((r) => r.id === repositoryId);
  const branches = selectedRepo?.branches ?? [];

  const handleSubmit = () => {
    const parsed = exportNameSchema.safeParse(exportName.trim());
    if (!parsed.success) {
      setNameError(t(parsed.error.issues[0].message));
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
          toast.error(t('export.toast.createStartFailed'));
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

  const isValid =
    exportName.trim() !== '' && repositoryId !== '' && branch !== '' && nodePath.trim() !== '';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          {t('export.action.createExport')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('export.dialog.create.title')}</DialogTitle>
          <DialogDescription>{t('export.dialog.create.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="export-repo">{t('export.field.repository')}</Label>
            <Select value={repositoryId} onValueChange={handleRepositoryChange}>
              <SelectTrigger id="export-repo">
                <SelectValue placeholder={t('export.field.selectRepository')} />
              </SelectTrigger>
              <SelectContent>
                {repositories.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="export-branch">{t('export.field.branch')}</Label>
            <Select
              value={branch}
              onValueChange={handleBranchChange}
              disabled={repositoryId === ''}
            >
              <SelectTrigger id="export-branch">
                <SelectValue placeholder={t('export.field.selectBranch')} />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="export-node-path">{t('export.field.nodePath')}</Label>
            <Input
              id="export-node-path"
              value={nodePath}
              onChange={(e) => setNodePath(e.target.value)}
              placeholder="/content"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="export-name">{t('export.field.exportName')}</Label>
            <Input
              id="export-name"
              value={exportName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t('export.field.exportNamePlaceholder')}
            />
            {nameError != null && <p className="text-destructive text-sm">{nameError}</p>}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>{t('common.action.cancel')}</Button>
          </DialogClose>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!isValid || createMutation.isPending}
          >
            {t('export.action.export')}
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [exportName, setExportName] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [branch, setBranch] = useState('');
  const [targetNodePath, setTargetNodePath] = useState('/content');
  const [includeNodeIds, setIncludeNodeIds] = useState(true);
  const [includePermissions, setIncludePermissions] = useState(true);
  const importMutation = useImportExport();

  const selectedRepo = repositories.find((r) => r.id === repositoryId);
  const branches = selectedRepo?.branches ?? [];

  const handleSubmit = () => {
    if (exportName === '' || repositoryId === '' || branch === '' || targetNodePath.trim() === '')
      return;

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
          toast.error(t('export.toast.importStartFailed'));
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

  const isValid =
    exportName !== '' && repositoryId !== '' && branch !== '' && targetNodePath.trim() !== '';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Import className="size-4" />
          {t('export.action.import')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('export.dialog.import.title')}</DialogTitle>
          <DialogDescription>{t('export.dialog.import.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="import-export">{t('export.field.export')}</Label>
            <Select value={exportName} onValueChange={setExportName}>
              <SelectTrigger id="import-export">
                <SelectValue placeholder={t('export.field.selectExport')} />
              </SelectTrigger>
              <SelectContent>
                {exports.map((exp) => (
                  <SelectItem key={exp.name} value={exp.name}>
                    {exp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="import-repo">{t('export.field.repository')}</Label>
            <Select value={repositoryId} onValueChange={handleRepositoryChange}>
              <SelectTrigger id="import-repo">
                <SelectValue placeholder={t('export.field.selectRepository')} />
              </SelectTrigger>
              <SelectContent>
                {repositories.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="import-branch">{t('export.field.branch')}</Label>
            <Select value={branch} onValueChange={setBranch} disabled={repositoryId === ''}>
              <SelectTrigger id="import-branch">
                <SelectValue placeholder={t('export.field.selectBranch')} />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="import-target-path">{t('export.field.targetPath')}</Label>
            <Input
              id="import-target-path"
              value={targetNodePath}
              onChange={(e) => setTargetNodePath(e.target.value)}
              placeholder="/content"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="import-node-ids"
              checked={includeNodeIds}
              onCheckedChange={(checked) => setIncludeNodeIds(checked === true)}
            />
            <Label htmlFor="import-node-ids">{t('export.field.includeNodeIds')}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="import-permissions"
              checked={includePermissions}
              onCheckedChange={(checked) => setIncludePermissions(checked === true)}
            />
            <Label htmlFor="import-permissions">{t('export.field.includePermissions')}</Label>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>{t('common.action.cancel')}</Button>
          </DialogClose>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!isValid || importMutation.isPending}
          >
            {t('export.action.import')}
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadExport();

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file == null) return;

    setUploadProgress(0);
    uploadMutation.mutate(
      { file, onProgress: setUploadProgress },
      {
        onSuccess: () => {
          const displayName = file.name.endsWith('.zip') ? file.name.slice(0, -4) : file.name;
          toast.success(t('export.toast.uploaded', { name: displayName }));
          setOpen(false);
          setUploadProgress(0);
        },
        onError: (error) => {
          const message =
            (error as { message?: string })?.message ?? t('export.toast.uploadFailed');
          toast.error(message);
          setUploadProgress(0);
        },
      },
    );

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
          {t('common.action.upload')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('export.dialog.upload.title')}</DialogTitle>
          <DialogDescription>{t('export.dialog.upload.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
            {t('dump.action.selectZip')}
          </Button>
          {uploadMutation.isPending && (
            <div className="flex items-center gap-2">
              <Progress value={uploadProgress} className="h-2 flex-1" />
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                {uploadProgress}%
              </span>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={uploadMutation.isPending}>{t('common.action.close')}</Button>
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
  const { t } = useTranslation();
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
      header: t('export.column.name'),
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor('timestamp', {
      header: t('export.column.timestamp'),
      cell: (info) => formatTimestamp(info.getValue()),
    }),
    columnHelper.accessor('format', {
      header: t('export.column.format'),
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor('nodeCount', {
      header: t('export.column.nodes'),
      cell: (info) => {
        const count = info.getValue();
        return count < 0 ? '\u2014' : count;
      },
    }),
    columnHelper.display({
      id: 'actions',
      header: '',
      cell: (info) => (
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
      <div className="border-border bg-card flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b px-4">
        <span className="text-foreground font-mono text-xs font-medium">{t('nav.exports')}</span>
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
          title={t('export.empty.title')}
          description={t('export.empty.description')}
          action={<CreateExportDialog repositories={repositories} onStartTask={handleStartTask} />}
        />
      ) : (
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
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
                    <span className="text-muted-foreground text-xs whitespace-nowrap">
                      {Math.round(progress)}%
                    </span>
                  </div>
                </TableCell>
                <TableCell />
              </TableRow>
            )}
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
          title={t(TASK_TYPE_KEYS[activeTask.type])}
          taskId={activeTask.id}
          open={dialogOpen}
        />
      )}

      {/* Completion dialog — dismissable */}
      {activeTask != null && isTaskTerminal && (
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            if (!open) handleDialogClose();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {task?.state === 'FINISHED'
                  ? t(TASK_COMPLETE_KEYS[activeTask.type])
                  : t('common.operation.failed')}
              </DialogTitle>
            </DialogHeader>
            {task?.state === 'FINISHED' &&
              (() => {
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
                    {task.progress.info || t('common.operation.completed')}
                  </p>
                );
              })()}
            {task?.state === 'FAILED' && (
              <p className="text-destructive text-sm">
                {task.progress.info || t('common.operation.failed')}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button>{t('common.action.close')}</Button>
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
