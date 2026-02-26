import { useQuery } from '@tanstack/react-query';
import { Shield, Table2 } from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { codeToHtml } from 'shiki';
import {
    type AccessControlEntry,
    type NodeDetail,
    type NodeDetailParams,
    nodeDetailQueryOptions,
} from '../lib/api/nodes';
import { cn } from '../lib/utils';
import { useTheme } from './theme-provider';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from './ui/sheet';
import { Skeleton } from './ui/skeleton';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from './ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

//
// * Types
//

export type NodeDetailPanelProps = {
    nodeId: string | null;
    repoId: string;
    branch: string;
    onClose: () => void;
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
            resolveTheme(theme) === 'dark' ? 'github-dark' : 'github-light';

        codeToHtml(json, { lang: 'json', theme: shikiTheme }).then(result => {
            if (!cancelled) setHtml(result);
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
// * NodeDetailContent
//

const NODE_DETAIL_CONTENT_NAME = 'NodeDetailContent';

const NodeDetailContent = ({
    params,
}: {
    params: NodeDetailParams;
}): ReactElement => {
    const { data: node, isLoading, error } = useQuery(nodeDetailQueryOptions(params));

    if (isLoading) {
        return (
            <div
                data-component={NODE_DETAIL_CONTENT_NAME}
                className="space-y-4 pt-4"
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
        <div data-component={NODE_DETAIL_CONTENT_NAME} className="flex h-full flex-col gap-4">
            <SheetHeader>
                <SheetTitle>{node._name}</SheetTitle>
                <SheetDescription>{node._path}</SheetDescription>
            </SheetHeader>
            <Tabs defaultValue="properties" className="flex-1">
                <TabsList className="w-full">
                    <TabsTrigger value="properties">Properties</TabsTrigger>
                    <TabsTrigger value="metadata">Metadata</TabsTrigger>
                    <TabsTrigger value="permissions">Permissions</TabsTrigger>
                    <TabsTrigger value="json">JSON</TabsTrigger>
                </TabsList>
                <ScrollArea className="h-[calc(100vh-12rem)]">
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
                </ScrollArea>
            </Tabs>
        </div>
    );
};

NodeDetailContent.displayName = NODE_DETAIL_CONTENT_NAME;

//
// * NodeDetailPanel
//

const NODE_DETAIL_PANEL_NAME = 'NodeDetailPanel';

const sheetContentClasses = cn(
    'w-[600px] overflow-hidden sm:max-w-[600px]',
);

export const NodeDetailPanel = ({
    nodeId,
    repoId,
    branch,
    onClose,
}: NodeDetailPanelProps): ReactElement | null => {
    const isOpen = nodeId != null;

    const handleOpenChange = (open: boolean): void => {
        if (!open) onClose();
    };

    if (!isOpen) return null;

    return (
        <Sheet open={isOpen} onOpenChange={handleOpenChange}>
            <SheetContent
                data-component={NODE_DETAIL_PANEL_NAME}
                side="right"
                className={sheetContentClasses}
            >
                <NodeDetailContent
                    params={{ repoId, branch, key: nodeId }}
                />
            </SheetContent>
        </Sheet>
    );
};

NodeDetailPanel.displayName = NODE_DETAIL_PANEL_NAME;
