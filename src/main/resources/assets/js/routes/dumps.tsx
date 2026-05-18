import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowUpCircle,
  Download,
  Ellipsis,
  HardDrive,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { ChangeEvent, ReactElement } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
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
  type Dump,
  dumpsQueryOptions,
  getDumpDownloadUrl,
  useCreateDump,
  useDeleteDump,
  useLoadDump,
  useUpgradeDump,
  useUploadDump,
} from '../lib/api/dumps';
import { getProgress, TERMINAL_STATES, taskQueryOptions } from '../lib/api/tasks';
import { useTaskProgress } from '../lib/hooks/use-task-progress';

const DUMPS_PAGE_NAME = 'DumpsPage';

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

function formatSize(bytes: number): string {
  if (bytes < 0) return '\u2014';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / 1024 ** i;

  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function generateDumpName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `dump-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

type ActiveTask = {
  id: string;
  type: 'create' | 'load' | 'upgrade';
  name?: string;
};

type DumpBranchResult = {
  branch: string;
  successful: number;
  errors: string[];
};

type DumpRepositoryResult = {
  repositoryId: string;
  branches: DumpBranchResult[];
  versions: number;
  versionsErrors: string[];
};

type DumpResult = {
  repositories: DumpRepositoryResult[];
};

function parseDumpResult(info: string): DumpResult | undefined {
  try {
    const parsed = JSON.parse(info);
    if (parsed?.repositories != null) return parsed as DumpResult;
    return undefined;
  } catch {
    return undefined;
  }
}

const TASK_TYPE_KEYS: Record<ActiveTask['type'], string> = {
  create: 'dump.task.creating',
  load: 'dump.task.loading',
  upgrade: 'dump.task.upgrading',
};

const TASK_COMPLETE_KEYS: Record<ActiveTask['type'], string> = {
  create: 'dump.task.created',
  load: 'dump.task.loaded',
  upgrade: 'dump.task.upgraded',
};

const columnHelper = createColumnHelper<Dump>();

// ? Number of visible columns: Name, Timestamp, XP Version, Model Version, Size, Actions
const COLUMN_COUNT = 6;

//
// * DumpResultSummary
//

const DumpResultSummary = ({ result }: { result: DumpResult }): ReactElement => {
  const { t } = useTranslation();
  const totalNodes = result.repositories.reduce(
    (sum, repo) => sum + repo.branches.reduce((s, b) => s + b.successful, 0),
    0,
  );
  const totalErrors = result.repositories.reduce(
    (sum, repo) =>
      sum + repo.branches.reduce((s, b) => s + b.errors.length, 0) + repo.versionsErrors.length,
    0,
  );

  const repoCount = result.repositories.length;

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        <Trans
          i18nKey="dump.result.summary"
          count={repoCount}
          values={{ repos: repoCount, nodes: totalNodes }}
        />
        {totalErrors > 0 && (
          <span className="text-destructive">
            {' '}
            {t('dump.result.errors', { count: totalErrors })}
          </span>
        )}
      </p>
      <div className="max-h-48 space-y-2 overflow-y-auto">
        {result.repositories.map((repo) => (
          <div key={repo.repositoryId}>
            <p className="font-mono text-xs font-medium">{repo.repositoryId}</p>
            <p className="text-muted-foreground text-xs">
              {repo.branches.map((b) => `${b.branch}: ${b.successful}`).join(' \u00b7 ')}
              {repo.versions > 0 &&
                ` \u00b7 ${t('dump.result.versions', { count: repo.versions })}`}
            </p>
            {repo.branches.some((b) => b.errors.length > 0) && (
              <p className="text-destructive text-xs">
                {repo.branches
                  .filter((b) => b.errors.length > 0)
                  .map((b) => `${b.branch}: ${b.errors.join(', ')}`)
                  .join(' \u00b7 ')}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

DumpResultSummary.displayName = 'DumpResultSummary';

//
// * LoadDumpWarning
//

type LoadDumpWarningProps = {
  dump: Dump;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

const LoadDumpWarning = ({
  dump,
  open,
  onOpenChange,
  onConfirm,
}: LoadDumpWarningProps): ReactElement => {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('dump.dialog.load.title')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <span>
              <Trans
                i18nKey="dump.dialog.load.description"
                values={{ name: dump.name }}
                components={{ strong: <strong /> }}
              />
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.action.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t('dump.dialog.load.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

//
// * RowActions
//

type RowActionsProps = {
  dump: Dump;
  onStartTask: (task: ActiveTask) => void;
};

const RowActions = ({ dump, onStartTask }: RowActionsProps): ReactElement => {
  const { t } = useTranslation();
  const [loadOpen, setLoadOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const loadMutation = useLoadDump();
  const upgradeMutation = useUpgradeDump();
  const deleteMutation = useDeleteDump();

  const handleLoad = () => {
    loadMutation.mutate(
      { name: dump.name, archive: dump.type === 'archived' },
      {
        onSuccess: (result) => {
          setLoadOpen(false);
          onStartTask({ id: result.taskId, type: 'load' });
        },
        onError: () => {
          toast.error(t('dump.toast.loadStartFailed', { name: dump.name }));
        },
      },
    );
  };

  const handleUpgrade = () => {
    upgradeMutation.mutate(dump.name, {
      onSuccess: (result) => {
        onStartTask({ id: result.taskId, type: 'upgrade' });
      },
      onError: () => {
        toast.error(t('dump.toast.upgradeStartFailed', { name: dump.name }));
      },
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate(dump.name, {
      onSuccess: () => {
        toast.success(t('dump.toast.deleted', { name: dump.name }));
        setDeleteOpen(false);
      },
      onError: () => {
        toast.error(t('dump.toast.deleteFailed', { name: dump.name }));
      },
    });
  };

  const isLoadable = dump.type === 'versioned' || dump.type === 'archived';

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
            {isLoadable && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setLoadOpen(true);
                }}
              >
                <RotateCcw className="size-4" />
                {t('common.action.load')}
              </DropdownMenuItem>
            )}
            {dump.type === 'versioned' && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleUpgrade();
                }}
              >
                <ArrowUpCircle className="size-4" />
                {t('dump.action.upgrade')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                window.open(getDumpDownloadUrl(dump.name), '_blank');
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

      <LoadDumpWarning
        dump={dump}
        open={loadOpen}
        onOpenChange={setLoadOpen}
        onConfirm={handleLoad}
      />

      <ConfirmDialog
        title={t('dump.dialog.delete.title')}
        description={t('dump.dialog.delete.description', { name: dump.name })}
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
// * CreateDumpDialog
//

type CreateDumpDialogProps = {
  onStartTask: (task: ActiveTask) => void;
};

const CreateDumpDialog = ({ onStartTask }: CreateDumpDialogProps): ReactElement => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [includeVersions, setIncludeVersions] = useState(false);
  const [maxVersions, setMaxVersions] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const createMutation = useCreateDump();

  const handleSubmit = () => {
    if (name.trim() === '') return;

    const dumpName = name.trim();
    createMutation.mutate(
      {
        name: dumpName,
        includeVersions: includeVersions || undefined,
        maxVersions: includeVersions && maxVersions !== '' ? Number(maxVersions) : undefined,
        maxAge: includeVersions && maxAge !== '' ? Number(maxAge) : undefined,
      },
      {
        onSuccess: (result) => {
          setOpen(false);
          resetForm();
          onStartTask({ id: result.taskId, type: 'create', name: dumpName });
        },
        onError: () => {
          toast.error(t('dump.toast.createStartFailed'));
        },
      },
    );
  };

  const resetForm = () => {
    setName('');
    setIncludeVersions(false);
    setMaxVersions('');
    setMaxAge('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setName(generateDumpName());
    } else {
      resetForm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          {t('dump.action.createDump')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dump.dialog.create.title')}</DialogTitle>
          <DialogDescription>{t('dump.dialog.create.description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="dump-name">{t('dump.field.name')}</Label>
            <Input
              id="dump-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dump.field.namePlaceholder')}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="dump-include-versions"
              checked={includeVersions}
              onCheckedChange={(checked) => setIncludeVersions(checked === true)}
            />
            <Label htmlFor="dump-include-versions">{t('dump.field.includeVersions')}</Label>
          </div>
          {includeVersions && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="dump-max-versions">{t('dump.field.maxVersions')}</Label>
                <Input
                  id="dump-max-versions"
                  type="number"
                  min="1"
                  value={maxVersions}
                  onChange={(e) => setMaxVersions(e.target.value)}
                  placeholder={t('common.field.optional')}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="dump-max-age">{t('dump.field.maxAge')}</Label>
                <Input
                  id="dump-max-age"
                  type="number"
                  min="1"
                  value={maxAge}
                  onChange={(e) => setMaxAge(e.target.value)}
                  placeholder={t('common.field.optional')}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>{t('common.action.cancel')}</Button>
          </DialogClose>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={name.trim() === '' || createMutation.isPending}
          >
            {t('common.action.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

//
// * UploadDumpDialog
//

const UploadDumpDialog = (): ReactElement => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useUploadDump();

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file == null) return;

    setUploadProgress(0);
    uploadMutation.mutate(
      { file, onProgress: setUploadProgress },
      {
        onSuccess: () => {
          const displayName = file.name.endsWith('.zip') ? file.name.slice(0, -4) : file.name;
          toast.success(t('dump.toast.uploaded', { name: displayName }));
          setOpen(false);
          setUploadProgress(0);
        },
        onError: (error) => {
          const message = (error as { message?: string })?.message ?? t('dump.toast.uploadFailed');
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
          <DialogTitle>{t('dump.dialog.upload.title')}</DialogTitle>
          <DialogDescription>{t('dump.dialog.upload.description')}</DialogDescription>
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
// * DumpsPage
//

const DumpsPage = (): ReactElement => {
  const { t } = useTranslation();
  const { data: dumps } = useSuspenseQuery(dumpsQueryOptions());
  const [activeTask, setActiveTask] = useState<ActiveTask | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const handledRef = useRef(false);

  const { data: task } = useQuery(taskQueryOptions(activeTask?.id));
  useTaskProgress(activeTask?.id);

  const isTaskTerminal = task != null && TERMINAL_STATES.includes(task.state);
  const isCreating = activeTask?.type === 'create' && !isTaskTerminal;
  const progress = getProgress(task);

  // ? Handle task completion once when terminal state is first reached
  useEffect(() => {
    if (!isTaskTerminal || handledRef.current) return;
    handledRef.current = true;
    queryClient.invalidateQueries({ queryKey: ['dumps'] });

    if (!dialogOpen) {
      setActiveTask(undefined);
    }
  }, [isTaskTerminal, dialogOpen, queryClient]);

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
      header: t('dump.column.name'),
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor('timestamp', {
      header: t('dump.column.timestamp'),
      cell: (info) => formatTimestamp(info.getValue()),
    }),
    columnHelper.accessor('xpVersion', {
      header: t('dump.column.xpVersion'),
      cell: (info) => info.getValue() || '\u2014',
    }),
    columnHelper.accessor('modelVersion', {
      header: t('dump.column.modelVersion'),
      cell: (info) => info.getValue() || '\u2014',
    }),
    columnHelper.accessor('size', {
      header: t('dump.column.size'),
      cell: (info) => formatSize(info.getValue()),
    }),
    columnHelper.display({
      id: 'actions',
      header: '',
      cell: (info) => (
        <div className="flex items-center justify-end gap-1">
          <RowActions dump={info.row.original} onStartTask={handleStartTask} />
        </div>
      ),
    }),
  ];

  const table = useReactTable({
    data: dumps,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div data-component={DUMPS_PAGE_NAME} className="flex flex-col">
      {/* Breadcrumb bar */}
      <div className="border-border bg-card flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b px-4">
        <span className="text-foreground font-mono text-xs font-medium">{t('nav.dumps')}</span>
      </div>

      {/* Action toolbar */}
      <div className="flex items-center gap-2 px-4 py-2">
        <div className="flex-1" />
        <UploadDumpDialog />
        <CreateDumpDialog onStartTask={handleStartTask} />
      </div>

      {dumps.length === 0 && !isCreating ? (
        <EmptyState
          icon={HardDrive}
          title={t('dump.empty.title')}
          description={t('dump.empty.description')}
          action={<CreateDumpDialog onStartTask={handleStartTask} />}
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

      {/* Task progress / completion dialog */}
      {activeTask != null && (
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            if (!open) handleDialogClose();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {isTaskTerminal
                  ? task?.state === 'FINISHED'
                    ? t(TASK_COMPLETE_KEYS[activeTask.type])
                    : t('common.operation.failed')
                  : t(TASK_TYPE_KEYS[activeTask.type])}
              </DialogTitle>
              {!isTaskTerminal && (
                <DialogDescription>
                  {task?.progress.info || t('common.progress.starting')}
                </DialogDescription>
              )}
            </DialogHeader>
            {!isTaskTerminal && (
              <>
                <Progress value={progress} className="w-full" />
                <p className="text-muted-foreground text-center text-sm">{Math.round(progress)}%</p>
              </>
            )}
            {task?.state === 'FINISHED' &&
              (() => {
                const result = parseDumpResult(task.progress.info);
                if (result != null) return <DumpResultSummary result={result} />;
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
                {isTaskTerminal ? (
                  <Button>{t('common.action.close')}</Button>
                ) : (
                  <Button variant="ghost">{t('common.action.close')}</Button>
                )}
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

DumpsPage.displayName = DUMPS_PAGE_NAME;

export const Route = createFileRoute('/dumps')({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(dumpsQueryOptions()),
  component: DumpsPage,
});
