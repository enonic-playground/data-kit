import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Braces,
  Copy,
  Ellipsis,
  History,
  ImageIcon,
  Info,
  PanelLeft,
  Pencil,
  Plus,
  Send,
  Shield,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createHighlighterCore } from 'shiki/core';
import langJson from 'shiki/dist/langs/json.mjs';
import themeGithubDarkDefault from 'shiki/dist/themes/github-dark-default.mjs';
import themeGithubLightDefault from 'shiki/dist/themes/github-light-default.mjs';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import { buildBinaryPreviewUrl } from '../lib/api/binary';
import { branchesQueryOptions } from '../lib/api/branches';
import {
  type AccessControlEntry,
  type NodeDetail,
  type NodeDetailParams,
  nodeDetailQueryOptions,
  nodeImageQueryOptions,
  useCreateNode,
  useDeleteNode,
  useDuplicateNode,
  useMoveNode,
  usePushNode,
  useRenameNode,
} from '../lib/api/nodes';
import { versionsInfiniteQueryOptions } from '../lib/api/versions';
import { cn } from '../lib/utils';
import { NodePropertiesTab } from './node-properties/node-properties-tab';
import { NodeVersionsTab } from './node-versions-tab';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Skeleton } from './ui/skeleton';
import { toast } from './ui/sonner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const highlighterPromise = createHighlighterCore({
  themes: [themeGithubDarkDefault, themeGithubLightDefault],
  langs: [langJson],
  engine: createJavaScriptRegexEngine(),
});

//
// * Types
//

export type NodeDetailViewProps = {
  nodeId: string;
  repoId: string;
  branch: string;
  railOpen: boolean;
  onToggleRail: () => void;
  onClose: () => void;
  onNodeMutated?: () => void;
  onNavigateToNode?: (nodeId: string) => void;
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
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

//
// * MetadataTab
//

const METADATA_TAB_NAME = 'MetadataTab';

const MetadataTab = ({ node }: { node: NodeDetail }): ReactElement => {
  const { t } = useTranslation();
  return (
    <div data-component={METADATA_TAB_NAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('node.metadata.column.field')}</TableHead>
            <TableHead>{t('node.metadata.column.value')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {METADATA_KEYS.map((key) => {
            const value = node[key] as string | undefined;
            return (
              <TableRow key={key}>
                <TableCell className="font-medium">{key}</TableCell>
                <TableCell className="font-mono text-sm break-all">
                  {key === '_nodeType' && value != null ? (
                    <Badge variant="secondary">{value}</Badge>
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

const PermissionsTab = ({ permissions }: { permissions: AccessControlEntry[] }): ReactElement => {
  const { t } = useTranslation();
  if (permissions.length === 0) {
    return (
      <div
        data-component={PERMISSIONS_TAB_NAME}
        className="text-muted-foreground flex flex-col items-center gap-2 py-8"
      >
        <Shield className="size-8" />
        <p className="text-sm">{t('node.permissions.empty')}</p>
      </div>
    );
  }

  return (
    <div data-component={PERMISSIONS_TAB_NAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('node.permissions.column.principal')}</TableHead>
            <TableHead>{t('node.permissions.column.allow')}</TableHead>
            <TableHead>{t('node.permissions.column.deny')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {permissions.map((entry) => (
            <TableRow key={entry.principal}>
              <TableCell className="font-medium">{entry.principal}</TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {entry.allow.map((perm) => (
                    <Badge key={perm} variant="secondary">
                      {perm}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {entry.deny.map((perm) => (
                    <Badge key={perm} variant="destructive">
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
      resolveTheme(theme) === 'dark' ? 'github-dark-default' : 'github-light-default';

    highlighterPromise.then((hl) => {
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
// * NodeActions
//

const NODE_ACTIONS_NAME = 'NodeActions';

type NodeActionsProps = {
  node: NodeDetail;
  repoId: string;
  branch: string;
  onNodeMutated?: () => void;
};

const NodeActions = ({ node, repoId, branch, onNodeMutated }: NodeActionsProps): ReactElement => {
  const { t } = useTranslation();
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
  const availableBranches = branches?.filter((b) => b.id !== branch) ?? [];

  const isRoot = node._path === '/';

  const handleDuplicate = () => {
    duplicateMutation.mutate(
      { repoId, branch, nodeId: node._id },
      {
        onSuccess: (result) => {
          toast.success(t('node.toast.duplicated', { name: result._name }));
        },
        onError: () => toast.error(t('node.toast.duplicateFailed', { name: node._name })),
      },
    );
  };

  const handleCreate = () => {
    if (createName.trim() === '') {
      setCreateError(t('node.error.nameRequired'));
      return;
    }
    if (createName.includes('/')) {
      setCreateError(t('node.error.nameNoSlashes'));
      return;
    }
    createMutation.mutate(
      {
        repoId,
        branch,
        parentPath: node._path,
        name: createName,
        nodeType: createType.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t('node.toast.created', { name: createName }));
          setCreateOpen(false);
          setCreateName('');
          setCreateType('');
          setCreateError(undefined);
        },
        onError: () => toast.error(t('node.toast.createFailed', { name: createName })),
      },
    );
  };

  const handleRename = () => {
    if (renameName.trim() === '') {
      setRenameError(t('node.error.nameRequired'));
      return;
    }
    if (renameName.includes('/')) {
      setRenameError(t('node.error.nameNoSlashes'));
      return;
    }
    if (renameName === node._name) {
      setRenameError(t('node.error.nameSame'));
      return;
    }
    renameMutation.mutate(
      { repoId, branch, key: node._id, newName: renameName },
      {
        onSuccess: () => {
          toast.success(t('node.toast.renamed', { name: renameName }));
          setRenameOpen(false);
        },
        onError: () => toast.error(t('node.toast.renameFailed')),
      },
    );
  };

  const handleMove = () => {
    if (movePath.trim() === '') {
      setMoveError(t('node.error.pathRequired'));
      return;
    }
    if (!movePath.startsWith('/')) {
      setMoveError(t('node.error.pathLeadingSlash'));
      return;
    }
    moveMutation.mutate(
      { repoId, branch, key: node._id, targetPath: movePath },
      {
        onSuccess: () => {
          toast.success(t('node.toast.moved', { path: movePath }));
          setMoveOpen(false);
          onNodeMutated?.();
        },
        onError: () => toast.error(t('node.toast.moveFailed')),
      },
    );
  };

  const handlePush = () => {
    if (pushTarget === '') return;
    pushMutation.mutate(
      {
        repoId,
        branch,
        key: node._id,
        target: pushTarget,
        includeChildren: pushChildren,
        resolve: pushResolve,
      },
      {
        onSuccess: (result) => {
          const failedCount = result.failed.length;
          if (failedCount > 0) {
            toast.warning(
              t('node.toast.pushedPartial', {
                target: pushTarget,
                succeeded: result.success.length,
                failed: failedCount,
              }),
            );
          } else {
            toast.success(
              t('node.toast.pushed', {
                target: pushTarget,
                count: result.success.length,
              }),
            );
          }
          setPushOpen(false);
        },
        onError: () => toast.error(t('node.toast.pushFailed')),
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
          onNodeMutated?.();
        },
        onError: () => toast.error(t('node.toast.deleteFailed', { name: node._name })),
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
            aria-label={t('node.actions.aria')}
          >
            <Ellipsis className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t('node.action.createChild')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={isRoot}
              onClick={() => {
                setRenameName(node._name);
                setRenameOpen(true);
              }}
            >
              <Pencil className="size-4" />
              {t('common.action.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isRoot} onClick={() => setMoveOpen(true)}>
              <ArrowRightLeft className="size-4" />
              {t('common.action.move')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDuplicate}>
              <Copy className="size-4" />
              {t('common.action.duplicate')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setPushOpen(true)}>
              <Send className="size-4" />
              {t('common.action.push')}
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
              {t('common.action.delete')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Create Child Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateName('');
            setCreateType('');
            setCreateError(undefined);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('node.dialog.create.title')}</DialogTitle>
            <DialogDescription>
              {t('node.dialog.create.description', { path: node._path })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="panel-create-name">{t('node.field.name')}</Label>
              <Input
                id="panel-create-name"
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value);
                  setCreateError(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
                placeholder={t('node.field.namePlaceholder')}
              />
              {createError != null && <p className="text-destructive text-sm">{createError}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="panel-create-type">{t('node.field.nodeType')}</Label>
              <Input
                id="panel-create-type"
                value={createType}
                onChange={(e) => setCreateType(e.target.value)}
                placeholder={t('node.field.nodeTypePlaceholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button>{t('common.action.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" onClick={handleCreate} disabled={createMutation.isPending}>
              {t('common.action.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          setRenameOpen(open);
          if (!open) {
            setRenameName(node._name);
            setRenameError(undefined);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('node.dialog.rename.title')}</DialogTitle>
            <DialogDescription>
              {t('node.dialog.rename.description', { name: node._name })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="panel-rename-name">{t('node.field.name')}</Label>
            <Input
              id="panel-rename-name"
              value={renameName}
              onChange={(e) => {
                setRenameName(e.target.value);
                setRenameError(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
              }}
            />
            {renameError != null && <p className="text-destructive text-sm">{renameError}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button>{t('common.action.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" onClick={handleRename} disabled={renameMutation.isPending}>
              {t('common.action.rename')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move Dialog */}
      <Dialog
        open={moveOpen}
        onOpenChange={(open) => {
          setMoveOpen(open);
          if (!open) {
            setMovePath('');
            setMoveError(undefined);
          }
        }}
      >
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
              <Label htmlFor="panel-move-path">{t('node.field.targetPath')}</Label>
              <Input
                id="panel-move-path"
                value={movePath}
                onChange={(e) => {
                  setMovePath(e.target.value);
                  setMoveError(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleMove();
                }}
                placeholder={t('node.field.targetPathPlaceholder')}
              />
              {moveError != null && <p className="text-destructive text-sm">{moveError}</p>}
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button>{t('common.action.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" onClick={handleMove} disabled={moveMutation.isPending}>
              {t('common.action.move')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Push Dialog */}
      <Dialog
        open={pushOpen}
        onOpenChange={(open) => {
          setPushOpen(open);
          if (!open) {
            setPushTarget('');
            setPushChildren(false);
            setPushResolve(true);
          }
        }}
      >
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
              <Select value={pushTarget} onValueChange={setPushTarget}>
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
                id="panel-push-children"
                checked={pushChildren}
                onCheckedChange={(checked) => setPushChildren(checked === true)}
              />
              <Label htmlFor="panel-push-children" className="font-normal">
                {t('node.field.includeChildren')}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="panel-push-resolve"
                checked={pushResolve}
                onCheckedChange={(checked) => setPushResolve(checked === true)}
              />
              <Label htmlFor="panel-push-resolve" className="font-normal">
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
              onClick={handlePush}
              disabled={pushMutation.isPending || pushTarget === ''}
            >
              {t('common.action.push')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
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
              id="panel-delete-all"
              checked={deleteAllBranches}
              onCheckedChange={(checked) => setDeleteAllBranches(checked === true)}
            />
            <Label htmlFor="panel-delete-all" className="font-normal">
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

NodeActions.displayName = NODE_ACTIONS_NAME;

//
// * NodeImagePreview
//

const NODE_IMAGE_PREVIEW_NAME = 'NodeImagePreview';

const NodeImagePreview = ({ src, alt }: { src: string; alt: string }): ReactElement => {
  return (
    <div data-component={NODE_IMAGE_PREVIEW_NAME} className="bg-muted flex justify-center p-4">
      <img src={src} alt={alt} className="max-h-[70vh] max-w-full object-contain" />
    </div>
  );
};

NodeImagePreview.displayName = NODE_IMAGE_PREVIEW_NAME;

//
// * NodeDetailContent
//

const NODE_DETAIL_CONTENT_NAME = 'NodeDetailContent';

const PROPERTIES_TAB = 'properties';
const PREVIEW_TAB = 'preview';

const NodeDetailContent = ({
  params,
  railOpen,
  onToggleRail,
  onClose,
  onNodeMutated,
  onNavigateToNode,
}: {
  params: NodeDetailParams;
  railOpen: boolean;
  onToggleRail: () => void;
  onClose: () => void;
  onNodeMutated?: () => void;
  onNavigateToNode?: (nodeId: string) => void;
}): ReactElement => {
  const { t } = useTranslation();
  const { data: node, isLoading, error } = useQuery(nodeDetailQueryOptions(params));
  const { data: image } = useQuery({
    ...nodeImageQueryOptions({ ...params, versionKey: node?._versionKey ?? '' }),
    enabled: node?._versionKey != null,
  });
  const versionsInfinite = useInfiniteQuery(
    versionsInfiniteQueryOptions({
      repoId: params.repoId,
      branch: params.branch,
      key: params.key,
    }),
  );
  const versionsTotal = versionsInfinite.data?.pages[0]?.total;
  const railLabel = t(railOpen ? 'node.rail.hide' : 'node.rail.show');

  // The tab shell outlives a node swap, so a Preview selection can survive onto a node with
  // no binary. `image` is `undefined` until the query settles and `null` once it settles
  // empty — only the settled answer may close the tab, or stepping between two image nodes
  // would drop out of Preview while the second one is still resolving. A failed node never
  // enables the image query at all, so it has to count as settled too.
  const nodeFailed = !isLoading && (error != null || node == null);
  const [tab, setTab] = useState<string>(PROPERTIES_TAB);
  if (tab === PREVIEW_TAB && (image === null || nodeFailed)) setTab(PROPERTIES_TAB);
  const showPreview = image != null || tab === PREVIEW_TAB;
  const previewUrl =
    node != null && image != null
      ? buildBinaryPreviewUrl({
          repoId: params.repoId,
          branch: params.branch,
          key: node._id,
          binaryReference: image.binaryReference,
          versionKey: node._versionKey,
        })
      : null;

  // Early-returning here would strand a failed node on a surface with no back control or
  // rail toggle, and remount the tabs on every uncached sibling step.
  const body = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="space-y-4 p-4">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-32 w-full" />
        </div>
      );
    }

    if (error != null || node == null) {
      return <div className="text-destructive py-8 text-center text-sm">{t('node.error.loadFailed')}</div>;
    }

    return (
      <>
        <TabsContent value={PROPERTIES_TAB}>
          <NodePropertiesTab
            node={node}
            repoId={params.repoId}
            branch={params.branch}
            image={image ?? undefined}
            onNavigateToNode={onNavigateToNode}
          />
        </TabsContent>
        <TabsContent value="metadata">
          <MetadataTab node={node} />
        </TabsContent>
        <TabsContent value="permissions">
          <PermissionsTab permissions={node._permissions ?? []} />
        </TabsContent>
        <TabsContent value="versions">
          <NodeVersionsTab
            repoId={params.repoId}
            branch={params.branch}
            nodeKey={params.key}
            nodeName={node._name}
          />
        </TabsContent>
        <TabsContent value="json">
          <JsonTab node={node} />
        </TabsContent>
        {showPreview && (
          <TabsContent value={PREVIEW_TAB}>
            {previewUrl != null ? (
              <NodeImagePreview src={previewUrl} alt={node._name} />
            ) : (
              <Skeleton className="h-60 w-full" />
            )}
          </TabsContent>
        )}
      </>
    );
  };

  return (
    <div data-component={NODE_DETAIL_CONTENT_NAME} className="flex h-full flex-col">
      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 px-4 pt-2">
          <button
            type="button"
            onClick={onToggleRail}
            aria-pressed={railOpen}
            aria-label={railLabel}
            title={railLabel}
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md',
              'text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              railOpen && 'bg-accent text-accent-foreground',
            )}
          >
            <PanelLeft className="size-4" />
          </button>
          <TabsList className="w-auto">
            <TabsTrigger
              value={PROPERTIES_TAB}
              title={t('node.tab.properties')}
              className="px-2 @[576px]:px-3"
            >
              <Table2 className="size-3.5" />
              <span className="ml-1.5 hidden @[576px]:inline">{t('node.tab.properties')}</span>
            </TabsTrigger>
            <TabsTrigger
              value="metadata"
              title={t('node.tab.metadata')}
              className="px-2 @[576px]:px-3"
            >
              <Info className="size-3.5" />
              <span className="ml-1.5 hidden @[576px]:inline">{t('node.tab.metadata')}</span>
            </TabsTrigger>
            <TabsTrigger
              value="permissions"
              title={t('node.tab.permissions')}
              className="px-2 @[576px]:px-3"
            >
              <Shield className="size-3.5" />
              <span className="ml-1.5 hidden @[576px]:inline">{t('node.tab.permissions')}</span>
            </TabsTrigger>
            <TabsTrigger
              value="versions"
              title={t('node.tab.versions')}
              className="px-2 @[576px]:px-3"
            >
              <History className="size-3.5" />
              <span className="ml-1.5 hidden @[576px]:inline">{t('node.tab.versions')}</span>
              {versionsTotal != null && (
                <Badge variant="secondary" className="ml-1.5 hidden @[576px]:inline-flex">
                  {versionsTotal}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="json" title={t('node.tab.json')} className="px-2 @[576px]:px-3">
              <Braces className="size-3.5" />
              <span className="ml-1.5 hidden @[576px]:inline">{t('node.tab.json')}</span>
            </TabsTrigger>
            {showPreview && (
              <TabsTrigger
                value={PREVIEW_TAB}
                title={t('node.tab.preview')}
                className="px-2 @[576px]:px-3"
              >
                <ImageIcon className="size-3.5" />
                <span className="ml-1.5 hidden @[576px]:inline">{t('node.tab.preview')}</span>
              </TabsTrigger>
            )}
          </TabsList>
          <div className="ml-auto flex shrink-0 items-center">
            {previewUrl != null && (
              <button
                type="button"
                onClick={() => setTab(PREVIEW_TAB)}
                className={cn(
                  'border-border mr-2 size-6 shrink-0 overflow-hidden rounded border',
                  'hover:border-accent-foreground transition-colors',
                )}
                aria-label={t('node.tab.preview')}
                title={t('node.tab.preview')}
              >
                <img src={previewUrl} alt="" className="size-full object-cover" />
              </button>
            )}
            {node != null && (
              <NodeActions
                node={node}
                repoId={params.repoId}
                branch={params.branch}
                onNodeMutated={onNodeMutated}
              />
            )}
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'ml-1 flex size-7 shrink-0 items-center justify-center rounded-md',
                'text-muted-foreground transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
              )}
              aria-label={t('node.action.backToList')}
              title={t('node.action.backToList')}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        {/* Remounts per node so a pending version confirm cannot outlive it; the tab shell
            sits outside, so which tab is open survives. */}
        <div key={params.key} className="flex-1 overflow-auto">
          {body()}
        </div>
      </Tabs>
    </div>
  );
};

NodeDetailContent.displayName = NODE_DETAIL_CONTENT_NAME;

//
// * NodeDetailView
//

const NODE_DETAIL_VIEW_NAME = 'NodeDetailView';

export const NodeDetailView = ({
  nodeId,
  repoId,
  branch,
  railOpen,
  onToggleRail,
  onClose,
  onNodeMutated,
  onNavigateToNode,
}: NodeDetailViewProps): ReactElement => {
  return (
    <div
      data-component={NODE_DETAIL_VIEW_NAME}
      className="bg-card @container flex min-w-0 flex-1 flex-col"
    >
      <NodeDetailContent
        params={{ repoId, branch, key: nodeId }}
        railOpen={railOpen}
        onToggleRail={onToggleRail}
        onClose={onClose}
        onNodeMutated={onNodeMutated}
        onNavigateToNode={onNavigateToNode}
      />
    </div>
  );
};

NodeDetailView.displayName = NODE_DETAIL_VIEW_NAME;
