import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronRight, Copy, GitCommit, History, RotateCcw } from 'lucide-react';
import { type MouseEvent, type ReactElement, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    type NodeVersionEntry,
    useSetActiveVersion,
    versionsInfiniteQueryOptions,
} from '../lib/api/versions';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ConfirmDialog } from './ui/confirm-dialog';
import { EmptyState } from './ui/empty-state';
import { Skeleton } from './ui/skeleton';
import { toast } from './ui/sonner';

//
// * Types
//

export type NodeVersionsTabProps = {
    repoId: string;
    branch: string;
    nodeKey: string;
    nodeName: string;
};

const NODE_VERSIONS_TAB_NAME = 'NodeVersionsTab';

const SHORT_ID_LENGTH = 6;

//
// * Helpers
//

function shortId(id: string): string {
    return id.slice(0, SHORT_ID_LENGTH);
}

function formatTime(ts: string): string {
    try {
        return new Date(ts).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    } catch {
        return ts;
    }
}

function formatFullTimestamp(ts: string): string {
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return ts;
    }
}

//
// * Sub-components
//

type VersionDetailRowProps = {
    label: string;
    children: ReactNode;
};

const VERSION_DETAIL_ROW_NAME = 'VersionDetailRow';

const VersionDetailRow = ({ label, children }: VersionDetailRowProps): ReactElement => (
    <div data-component={VERSION_DETAIL_ROW_NAME} className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-muted-foreground text-xs">{label}</span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
);

VersionDetailRow.displayName = VERSION_DETAIL_ROW_NAME;

type CopyIconButtonProps = {
    value: string;
    label: string;
    toastText: string;
};

const COPY_ICON_BUTTON_NAME = 'CopyIconButton';

const CopyIconButton = ({ value, label, toastText }: CopyIconButtonProps): ReactElement => {
    const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        toast.success(toastText);
    };

    return (
        <button
            data-component={COPY_ICON_BUTTON_NAME}
            type="button"
            aria-label={label}
            title={label}
            onClick={handleClick}
            className={cn(
                'inline-flex size-5 shrink-0 items-center justify-center rounded-sm',
                'text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
            )}
        >
            <Copy className="size-3" />
        </button>
    );
};

CopyIconButton.displayName = COPY_ICON_BUTTON_NAME;

//
// * Main component
//

export const NodeVersionsTab = ({
    repoId,
    branch,
    nodeKey,
    nodeName,
}: NodeVersionsTabProps): ReactElement => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [pendingVersion, setPendingVersion] = useState<NodeVersionEntry | undefined>(undefined);

    const {
        data,
        isLoading,
        error,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useInfiniteQuery(versionsInfiniteQueryOptions({ repoId, branch, key: nodeKey }));

    const setActiveMutation = useSetActiveVersion();

    const versions = useMemo<NodeVersionEntry[]>(
        () => data?.pages.flatMap(p => p.hits) ?? [],
        [data],
    );
    const activeVersionId = data?.pages[0]?.activeVersionId ?? null;

    const toggleExpand = (versionId: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(versionId)) next.delete(versionId);
            else next.add(versionId);
            return next;
        });
    };

    const handleSetActive = () => {
        if (pendingVersion == null) return;
        setActiveMutation.mutate(
            { repoId, branch, key: nodeKey, versionId: pendingVersion.versionId },
            {
                onSuccess: () => {
                    toast.success(t('versions.toast.activated'));
                    setPendingVersion(undefined);
                },
                onError: () => {
                    toast.error(t('versions.toast.activateFailed'));
                },
            },
        );
    };

    if (isLoading) {
        return (
            <div data-component={NODE_VERSIONS_TAB_NAME} className="space-y-1 p-2">
                {Array.from({ length: 6 }).map((_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
                    <Skeleton key={i} className="h-8 w-full" />
                ))}
            </div>
        );
    }

    if (error != null) {
        return (
            <div
                data-component={NODE_VERSIONS_TAB_NAME}
                className="py-8 text-center text-destructive text-sm"
            >
                {t('versions.error.loadFailed')}
            </div>
        );
    }

    if (versions.length === 0) {
        return (
            <div data-component={NODE_VERSIONS_TAB_NAME}>
                <EmptyState
                    icon={History}
                    title={t('versions.empty.title')}
                    description={t('versions.empty.description')}
                />
            </div>
        );
    }

    return (
        <div data-component={NODE_VERSIONS_TAB_NAME} className="flex flex-col">
            <ul role="list" className="divide-y divide-border">
                {versions.map(v => {
                    const isExpanded = expanded.has(v.versionId);
                    const isActive = v.versionId === activeVersionId;
                    return (
                        <li key={v.versionId}>
                            <button
                                type="button"
                                aria-expanded={isExpanded}
                                onClick={() => toggleExpand(v.versionId)}
                                className={cn(
                                    'flex w-full items-center gap-2 px-4 py-2 text-left text-sm',
                                    'hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none',
                                )}
                            >
                                <ChevronRight
                                    className={cn(
                                        'size-3.5 shrink-0 text-muted-foreground transition-transform',
                                        isExpanded && 'rotate-90',
                                    )}
                                />
                                <span
                                    className="w-20 shrink-0 font-mono text-muted-foreground text-xs"
                                    title={formatFullTimestamp(v.timestamp)}
                                >
                                    {formatTime(v.timestamp)}
                                </span>
                                <span className="shrink-0 font-mono text-xs">
                                    {shortId(v.versionId)}
                                </span>
                                {isActive && (
                                    <Badge variant="outline" className="ml-auto">
                                        {t('versions.badge.active')}
                                    </Badge>
                                )}
                            </button>

                            {isExpanded && (
                                <div className="space-y-2 bg-muted/30 px-4 pt-1 pb-3">
                                    <VersionDetailRow label={t('versions.label.version')}>
                                        <span className="break-all font-mono text-xs">
                                            {v.versionId}
                                        </span>
                                        <CopyIconButton
                                            value={v.versionId}
                                            label={t('versions.action.copyVersionId')}
                                            toastText={t('versions.toast.versionIdCopied')}
                                        />
                                    </VersionDetailRow>
                                    <VersionDetailRow label={t('versions.label.committed')}>
                                        <span className="font-mono text-xs">
                                            {formatFullTimestamp(v.timestamp)}
                                        </span>
                                    </VersionDetailRow>
                                    {v.commit != null && (
                                        <VersionDetailRow label={t('versions.label.commit')}>
                                            <GitCommit className="size-3.5 shrink-0 text-muted-foreground" />
                                            <span className="break-all font-mono text-xs">
                                                {shortId(v.commit.id)} — {v.commit.message}
                                            </span>
                                            <span className="shrink-0 text-muted-foreground text-xs">
                                                {t('versions.label.committedBy', { committer: v.commit.committer })}
                                            </span>
                                        </VersionDetailRow>
                                    )}
                                    {!isActive && (
                                        <div className="flex justify-end pt-1">
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                onClick={() => setPendingVersion(v)}
                                            >
                                                <RotateCcw className="size-3.5" />
                                                {t('versions.action.setActive')}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>

            {hasNextPage && (
                <div className="p-3 text-center">
                    <Button
                        variant="default"
                        size="sm"
                        disabled={isFetchingNextPage}
                        onClick={() => fetchNextPage()}
                    >
                        {isFetchingNextPage ? t('common.loading') : t('common.action.loadMore')}
                    </Button>
                </div>
            )}

            <ConfirmDialog
                open={pendingVersion != null}
                onOpenChange={open => {
                    if (!open) setPendingVersion(undefined);
                }}
                variant="primary"
                title={t('versions.dialog.activate.title')}
                description={
                    pendingVersion != null
                        ? t('versions.dialog.activate.description', {
                              version: shortId(pendingVersion.versionId),
                              timestamp: formatFullTimestamp(pendingVersion.timestamp),
                              name: nodeName,
                          })
                        : ''
                }
                confirmLabel={t('versions.action.setActive')}
                onConfirm={handleSetActive}
            />
        </div>
    );
};

NodeVersionsTab.displayName = NODE_VERSIONS_TAB_NAME;
