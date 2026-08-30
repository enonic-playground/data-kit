import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowLeft,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  LayoutGrid,
  LayoutList,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { Fragment, type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { NodeDetailView } from '../components/node-detail-view';
import { NodeGrid } from '../components/node-grid';
import { NodeSiblingRail } from '../components/node-sibling-rail';
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
  nodeDetailQueryOptions,
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
const NODE_BROWSE_LIST_NAME = 'NodeBrowseList';

const DEFAULT_COUNT = 25;

const searchSchema = z.object({
  path: z.string().default('/'),
  start: z.number().int().min(0).default(0),
  count: z.number().int().min(1).max(100).default(DEFAULT_COUNT),
  nodeId: z.string().optional(),
  view: z.enum(['list', 'grid']).default('list'),
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

/** Anything that owns the arrow keys itself — native controls plus every Radix overlay. */
const KEYBOARD_SURFACE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="dialog"]',
  // Radix AlertDialog reports `alertdialog`, and the Versions tab's revert confirm is one.
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="combobox"]',
  '[data-radix-popper-content-wrapper]',
].join(', ');

const RAIL_OPEN_STORAGE_KEY = 'datakit:node-rail-open';

function readRailOpen(): boolean {
  try {
    return window.localStorage.getItem(RAIL_OPEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeRailOpen(open: boolean): void {
  try {
    window.localStorage.setItem(RAIL_OPEN_STORAGE_KEY, String(open));
  } catch {
    // ignore quota / disabled storage
  }
}

//
// * BreadcrumbToolbar
//

type BreadcrumbToolbarProps = {
  repoId: string;
  branch: string;
  path: string;
  nodeName?: string;
  onNavigate: (path: string) => void;
  children?: ReactNode;
};

const BREADCRUMB_TOOLBAR_NAME = 'BreadcrumbToolbar';

const crumbClasses = 'font-mono text-xs text-muted-foreground hover:text-foreground';
const crumbActiveClasses = 'font-medium font-mono text-xs text-foreground';
const separatorClasses = 'size-2.5 shrink-0 text-text-dimmed';

const BreadcrumbToolbar = ({
  repoId,
  branch,
  path,
  nodeName,
  onNavigate,
  children,
}: BreadcrumbToolbarProps): ReactElement => {
  const { t } = useTranslation();
  const segments = path === '/' ? [] : path.split('/').filter(Boolean);
  // The node, when one is selected, is the leaf — so no path segment is the active crumb.
  const isRootPath = segments.length === 0 && nodeName == null;

  return (
    <div
      data-component={BREADCRUMB_TOOLBAR_NAME}
      className="border-border bg-card flex h-10 shrink-0 items-center gap-2 border-b px-4"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        <Link to="/repositories" className={crumbClasses}>
          {t('nav.repositories')}
        </Link>
        <ChevronRight className={separatorClasses} />
        <Link to="/repositories/$repoId" params={{ repoId }} className={crumbClasses}>
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
          const isLast = index === segments.length - 1 && nodeName == null;

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
        {nodeName != null && (
          <>
            <ChevronRight className={separatorClasses} />
            <span className={crumbActiveClasses}>{nodeName}</span>
          </>
        )}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
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

const RenameDialog = ({
  node,
  repoId,
  branch,
  open,
  onOpenChange,
}: RenameDialogProps): ReactElement => {
  const { t } = useTranslation();
  const [name, setName] = useState(node._name);
  const [error, setError] = useState<string | undefined>();
  const renameMutation = useRenameNode();

  const handleSubmit = () => {
    if (name.trim() === '') {
      setError(t('node.error.nameRequired'));
      return;
    }
    if (name.includes('/')) {
      setError(t('node.error.nameNoSlashes'));
      return;
    }
    if (name === node._name) {
      setError(t('node.error.nameSame'));
      return;
    }

    renameMutation.mutate(
      { repoId, branch, key: node._id, newName: name },
      {
        onSuccess: () => {
          toast.success(t('node.toast.renamed', { name }));
          onOpenChange(false);
        },
        onError: () => {
          toast.error(t('node.toast.renameFailed'));
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
          <DialogTitle>{t('node.dialog.rename.title')}</DialogTitle>
          <DialogDescription>
            {t('node.dialog.rename.description', { name: node._name })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-4">
          <Label htmlFor="rename-name">{t('node.field.name')}</Label>
          <Input
            id="rename-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />
          {error != null && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>{t('common.action.cancel')}</Button>
          </DialogClose>
          <Button variant="primary" onClick={handleSubmit} disabled={renameMutation.isPending}>
            {t('common.action.rename')}
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

const MoveDialog = ({
  node,
  repoId,
  branch,
  open,
  onOpenChange,
}: MoveDialogProps): ReactElement => {
  const { t } = useTranslation();
  const [targetPath, setTargetPath] = useState('');
  const [error, setError] = useState<string | undefined>();
  const moveMutation = useMoveNode();

  const handleSubmit = () => {
    if (targetPath.trim() === '') {
      setError(t('node.error.pathRequired'));
      return;
    }
    if (!targetPath.startsWith('/')) {
      setError(t('node.error.pathLeadingSlash'));
      return;
    }

    moveMutation.mutate(
      { repoId, branch, key: node._id, targetPath },
      {
        onSuccess: () => {
          toast.success(t('node.toast.moved', { path: targetPath }));
          onOpenChange(false);
        },
        onError: () => {
          toast.error(t('node.toast.moveFailed'));
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
          <DialogTitle>{t('node.dialog.move.title')}</DialogTitle>
          <DialogDescription>
            {t('node.dialog.move.description', { name: node._name })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-1">
            <Label className="text-muted-foreground">{t('node.field.currentPath')}</Label>
            <button
              type="button"
              className="hover:text-foreground cursor-pointer truncate text-left font-mono text-sm"
              title={t('node.action.copyPath')}
              onClick={() => {
                navigator.clipboard.writeText(node._path);
                toast.success(t('node.toast.pathCopied'));
              }}
            >
              {node._path}
            </button>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="move-path">{t('node.field.targetPath')}</Label>
            <Input
              id="move-path"
              value={targetPath}
              onChange={(e) => {
                setTargetPath(e.target.value);
                setError(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
              placeholder={t('node.field.targetPathPlaceholder')}
            />
            {error != null && <p className="text-destructive text-sm">{error}</p>}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>{t('common.action.cancel')}</Button>
          </DialogClose>
          <Button variant="primary" onClick={handleSubmit} disabled={moveMutation.isPending}>
            {t('common.action.move')}
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

const PushDialog = ({
  node,
  repoId,
  branch,
  open,
  onOpenChange,
}: PushDialogProps): ReactElement => {
  const { t } = useTranslation();
  const [target, setTarget] = useState('');
  const [includeChildren, setIncludeChildren] = useState(false);
  const [resolve, setResolve] = useState(true);
  const pushMutation = usePushNode();

  const { data: branches } = useQuery(branchesQueryOptions(repoId));
  const availableBranches = branches?.filter((b) => b.id !== branch) ?? [];

  const handleSubmit = () => {
    if (target === '') return;

    pushMutation.mutate(
      { repoId, branch, key: node._id, target, includeChildren, resolve },
      {
        onSuccess: (result) => {
          const successCount = result.success.length;
          const failedCount = result.failed.length;
          if (failedCount > 0) {
            toast.warning(
              t('node.toast.pushedPartial', {
                target,
                succeeded: successCount,
                failed: failedCount,
              }),
            );
          } else {
            toast.success(
              t('node.toast.pushed', {
                target,
                count: successCount,
              }),
            );
          }
          onOpenChange(false);
        },
        onError: () => {
          toast.error(t('node.toast.pushFailed'));
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
          <DialogTitle>{t('node.dialog.push.title')}</DialogTitle>
          <DialogDescription>
            {t('node.dialog.push.description', { name: node._name })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>{t('node.field.targetBranch')}</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue placeholder={t('node.field.selectBranch')} />
              </SelectTrigger>
              <SelectContent>
                {availableBranches.map((b) => (
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
              onCheckedChange={(checked) => setIncludeChildren(checked === true)}
            />
            <Label htmlFor="push-children" className="font-normal">
              {t('node.field.includeChildren')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="push-resolve"
              checked={resolve}
              onCheckedChange={(checked) => setResolve(checked === true)}
            />
            <Label htmlFor="push-resolve" className="font-normal">
              {t('node.field.resolveDependencies')}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>{t('common.action.cancel')}</Button>
          </DialogClose>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={pushMutation.isPending || target === ''}
          >
            {t('common.action.push')}
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

const RowActions = ({
  node,
  repoId,
  branch,
  onPreview,
  onDeleted,
}: RowActionsProps): ReactElement => {
  const { t } = useTranslation();
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
          toast.success(t('node.toast.duplicated', { name: result._name }));
        },
        onError: () => {
          toast.error(t('node.toast.duplicateFailed', { name: node._name }));
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
            toast.success(t('node.toast.deletedFromBranches', { name: node._name, count }));
          } else {
            toast.success(t('node.toast.deleted', { name: node._name }));
          }
          setDeleteOpen(false);
          setDeleteAllBranches(false);
          onDeleted?.();
        },
        onError: () => {
          toast.error(t('node.toast.deleteFailed', { name: node._name }));
        },
      },
    );
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
                onPreview(node._id);
              }}
            >
              <Eye className="size-4" />
              {t('common.action.preview')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setRenameOpen(true);
              }}
            >
              <Pencil className="size-4" />
              {t('common.action.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setMoveOpen(true);
              }}
            >
              <ArrowRightLeft className="size-4" />
              {t('common.action.move')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                handleDuplicate();
              }}
            >
              <Copy className="size-4" />
              {t('common.action.duplicate')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setPushOpen(true);
              }}
            >
              <Send className="size-4" />
              {t('common.action.push')}
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
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteAllBranches(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('node.dialog.delete.title')}</DialogTitle>
            <DialogDescription>
              {t('node.dialog.delete.description', { name: node._name, path: node._path })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 py-2">
            <Checkbox
              id={`delete-all-${node._id}`}
              checked={deleteAllBranches}
              onCheckedChange={(checked) => setDeleteAllBranches(checked === true)}
            />
            <Label htmlFor={`delete-all-${node._id}`} className="font-normal">
              {t('node.field.deleteFromAllBranches')}
            </Label>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button>{t('common.action.cancel')}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {t('common.action.delete')}
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [nodeType, setNodeType] = useState('');
  const [error, setError] = useState<string | undefined>();
  const createMutation = useCreateNode();

  const handleSubmit = () => {
    if (name.trim() === '') {
      setError(t('node.error.nameRequired'));
      return;
    }
    if (name.includes('/')) {
      setError(t('node.error.nameNoSlashes'));
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
          toast.success(t('node.toast.created', { name }));
          setOpen(false);
          setName('');
          setNodeType('');
          setError(undefined);
        },
        onError: () => {
          toast.error(t('node.toast.createFailed', { name }));
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
          {t('node.action.createNode')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('node.dialog.createNode.title')}</DialogTitle>
          <DialogDescription>
            {t('node.dialog.createNode.description', { path: parentPath })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="create-name">{t('node.field.name')}</Label>
            <Input
              id="create-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
              placeholder={t('node.field.namePlaceholder')}
            />
            {error != null && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="create-type">{t('node.field.nodeType')}</Label>
            <Input
              id="create-type"
              value={nodeType}
              onChange={(e) => setNodeType(e.target.value)}
              placeholder={t('node.field.nodeTypePlaceholder')}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button>{t('common.action.cancel')}</Button>
          </DialogClose>
          <Button variant="primary" onClick={handleSubmit} disabled={createMutation.isPending}>
            {t('common.action.create')}
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
  const { t } = useTranslation();
  const { repoId, branch } = Route.useParams();
  const { path, start, count, nodeId, view: viewMode } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [railOpen, setRailOpen] = useState(readRailOpen);

  const setViewMode = (view: 'list' | 'grid') => {
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, view }) });
  };

  const toggleRail = () => {
    const next = !railOpen;
    setRailOpen(next);
    writeRailOpen(next);
  };

  const { data } = useSuspenseQuery(
    nodesQueryOptions({
      repoId,
      branch,
      parentPath: path,
      start,
      count,
      images: viewMode === 'grid',
    }),
  );

  // Shares a query key with the detail view, so this hits the cache rather than refetching.
  const { data: selectedNode } = useQuery({
    ...nodeDetailQueryOptions({ repoId, branch, key: nodeId ?? '' }),
    enabled: nodeId != null,
  });

  // A Reference click sets `nodeId` without touching `path`, so the node can sit under a
  // different parent — leaving the breadcrumb and the rail describing the wrong place.
  useEffect(() => {
    if (nodeId == null || selectedNode == null) return;
    const parentPath = getParentPath(selectedNode._path);
    if (parentPath === path) return;

    navigate({
      replace: true,
      search: { path: parentPath, start: 0, count, view: viewMode, nodeId },
    });
  }, [nodeId, selectedNode, path, count, viewMode, navigate]);

  useEffect(() => {
    if (nodeId == null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // Held keys repeat ~30/s, and each step pushes a history entry.
      if (e.repeat) return;
      // Radix preventDefaults for its own roving focus but never stopPropagation, so an
      // arrow inside a menu or dialog still reaches window and would swap the node under it.
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(KEYBOARD_SURFACE_SELECTOR) != null) return;

      const index = data.nodes.findIndex((node) => node._id === nodeId);
      if (index < 0) return;
      // At either end the key is left to the browser, so the rail still scrolls.
      const next = data.nodes[index + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next == null) return;

      e.preventDefault();
      navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, nodeId: next._id }) });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [nodeId, data.nodes, navigate]);

  const navigateToPath = (newPath: string) => {
    navigate({
      search: { path: newPath, start: 0, count, view: viewMode },
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
      header: t('node.column.name'),
      cell: (info) => {
        const node = info.row.original;
        const Icon = node.hasChildren ? Folder : FileText;

        return (
          <span className="flex items-center gap-2">
            <Icon className="text-muted-foreground size-3.5 shrink-0" />
            <span className="font-mono text-[13px]">{node._name}</span>
          </span>
        );
      },
    }),
    columnHelper.accessor('_nodeType', {
      header: t('node.column.type'),
      meta: { className: 'w-35' },
      cell: (info) => <Badge variant="secondary">{info.getValue()}</Badge>,
    }),
    columnHelper.accessor('_ts', {
      header: t('node.column.modified'),
      meta: { className: 'w-45' },
      cell: (info) => (
        <span className="text-muted-foreground font-mono text-xs">
          {formatTimestamp(info.getValue())}
        </span>
      ),
    }),
    columnHelper.display({
      id: 'actions',
      header: '',
      meta: { className: 'w-20' },
      cell: (info) => (
        <div className="flex items-center justify-end gap-1">
          <RowActions
            node={info.row.original}
            repoId={repoId}
            branch={branch}
            onPreview={openNodeDetail}
            onDeleted={() => handleNodeDeleted(info.row.original._id)}
          />
          <ChevronRight
            className={cn(
              'size-4',
              info.row.original.hasChildren ? 'text-muted-foreground' : 'invisible',
            )}
          />
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

  const navigateUp = () => {
    if (isRoot) {
      navigate({ to: '/repositories/$repoId', params: { repoId } });
      return;
    }
    navigateToPath(getParentPath(path));
  };

  const listView = (
    <Table className="table-fixed">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const meta = header.column.columnDef.meta as { className?: string } | undefined;
              return (
                <TableHead key={header.id} className={meta?.className}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        <TableRow className="cursor-pointer" onClick={navigateUp}>
          <TableCell colSpan={columns.length}>
            <span className="text-muted-foreground flex min-h-8 items-center gap-2">
              <ArrowLeft className="size-3.5 shrink-0" />
              <span className="font-mono text-[13px]">..</span>
            </span>
          </TableCell>
        </TableRow>
        {table.getRowModel().rows.map((row) => {
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
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as { className?: string } | undefined;
                return (
                  <TableCell key={cell.id} className={meta?.className}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  const gridView = (
    <NodeGrid
      nodes={data.nodes}
      repoId={repoId}
      branch={branch}
      selectedNodeId={nodeId}
      onSelect={openNodeDetail}
      onNavigate={navigateToPath}
      onNavigateUp={navigateUp}
    />
  );

  return (
    <div data-component={NODE_BROWSER_PAGE_NAME} className="flex h-full flex-col">
      <BreadcrumbToolbar
        repoId={repoId}
        branch={branch}
        path={path}
        nodeName={nodeId != null ? selectedNode?._name : undefined}
        onNavigate={navigateToPath}
      >
        <CreateNodeDialog repoId={repoId} branch={branch} parentPath={path} />
        {/* The view mode governs the browse list, which is not on screen under a node. */}
        {nodeId == null && (
          <>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className={cn(viewMode === 'list' && 'bg-accent')}
                aria-label={t('node.view.list')}
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
              >
                <LayoutList className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(viewMode === 'grid' && 'bg-accent')}
                aria-label={t('node.view.grid')}
                aria-pressed={viewMode === 'grid'}
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className="size-4" />
              </Button>
            </div>
          </>
        )}
      </BreadcrumbToolbar>

      <div className="flex flex-1 overflow-hidden">
        {nodeId != null && railOpen && (
          <NodeSiblingRail
            nodes={data.nodes}
            selectedNodeId={nodeId}
            onSelect={openNodeDetail}
            onNavigate={navigateToPath}
            // `path` is already the node's parent, so leaving the node *is* going up.
            onNavigateUp={closeNodeDetail}
          />
        )}
        {/* Hidden rather than unmounted so returning from a node restores the list's scroll
            position; `inert` keeps the offscreen rows out of the tab order and a11y tree. */}
        <div
          data-component={NODE_BROWSE_LIST_NAME}
          inert={nodeId != null}
          className={cn('flex-1 flex-col overflow-auto', nodeId != null ? 'hidden' : 'flex')}
        >
            {viewMode === 'grid' ? gridView : listView}
            {data.nodes.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={FolderOpen}
                  title={t('node.empty.title')}
                  description={t('node.empty.description')}
                />
              </div>
            ) : (
              data.total > 0 && (
                <div
                  className={cn(
                    'flex shrink-0 items-center justify-between px-4 py-3',
                    'border-border border-t',
                  )}
                >
                  <span className="text-muted-foreground font-mono text-xs">
                    {t('common.pagination.range', { start: start + 1, end, total: data.total })}
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
                            view: viewMode,
                          },
                        })
                      }
                    >
                      <ChevronLeft className="size-4" />
                      {t('common.pagination.previous')}
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
                            view: viewMode,
                          },
                        })
                      }
                    >
                      {t('common.pagination.next')}
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                </div>
              )
            )}
        </div>
        {nodeId != null && (
          <NodeDetailView
            nodeId={nodeId}
            repoId={repoId}
            branch={branch}
            railOpen={railOpen}
            onToggleRail={toggleRail}
            onClose={closeNodeDetail}
            onNodeMutated={closeNodeDetail}
            onNavigateToNode={openNodeDetail}
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
  loader: ({
    context: { queryClient },
    params: { repoId, branch },
    deps: { path, start, count, view },
  }) =>
    queryClient.ensureQueryData(
      nodesQueryOptions({
        repoId,
        branch,
        parentPath: path,
        start,
        count,
        images: view === 'grid',
      }),
    ),
  component: NodeBrowserPage,
});
