import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import {
    type AuditEntry,
    type AuditListParams,
    auditLogQueryOptions,
} from '../lib/api/audit';
import { cn } from '../lib/utils';

const AUDIT_PAGE_NAME = 'AuditPage';

const DEFAULT_COUNT = 25;

const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

const EMPTY_FILTERS: Filters = {
    from: '',
    to: '',
    type: '',
    source: '',
    user: '',
};

type Filters = {
    from: string;
    to: string;
    type: string;
    source: string;
    user: string;
};

function toListParams(filters: Filters, start: number): AuditListParams {
    return {
        from: filters.from || undefined,
        to: filters.to || undefined,
        type: filters.type || undefined,
        source: filters.source || undefined,
        user: filters.user || undefined,
        start,
        count: DEFAULT_COUNT,
    };
}

function formatTimestamp(time: string): string {
    const d = new Date(time);
    return Number.isNaN(d.getTime()) ? time : d.toLocaleString();
}

function formatObjects(objects: string[]): string {
    if (objects.length === 0) return '—';
    const [first, ...rest] = objects;
    return rest.length > 0 ? `${first} +${rest.length}` : first;
}

//
// * AuditRow
//

type AuditRowProps = {
    entry: AuditEntry;
    expanded: boolean;
    onToggle: (id: string) => void;
};

const AUDIT_ROW_NAME = 'AuditRow';

const AuditRow = ({ entry, expanded, onToggle }: AuditRowProps): ReactElement => {
    return (
        <>
            <TableRow
                data-component={AUDIT_ROW_NAME}
                onClick={() => onToggle(entry._id)}
                className="cursor-pointer"
                data-state={expanded ? 'selected' : undefined}
            >
                <TableCell className="w-8 pr-0">
                    <ChevronRight
                        className={cn(
                            'size-3.5 text-muted-foreground transition-transform',
                            expanded && 'rotate-90',
                        )}
                    />
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                    {formatTimestamp(entry.time)}
                </TableCell>
                <TableCell>
                    <Badge variant="secondary">{entry.type}</Badge>
                </TableCell>
                <TableCell className="text-xs">{entry.user || '—'}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                    {entry.source || '—'}
                </TableCell>
                <TableCell className="max-w-[320px] truncate text-muted-foreground text-xs">
                    {formatObjects(entry.objects)}
                </TableCell>
            </TableRow>
            {expanded && (
                <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={6} className="bg-muted/40 p-0 font-sans">
                        <pre className="overflow-x-auto px-4 py-3 font-mono text-foreground text-xs">
                            {JSON.stringify(entry.data, null, 2)}
                        </pre>
                    </TableCell>
                </TableRow>
            )}
        </>
    );
};

AuditRow.displayName = AUDIT_ROW_NAME;

//
// * AuditPage
//

const AuditPage = (): ReactElement => {
    const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
    const [activeFilters, setActiveFilters] = useState<Filters>(EMPTY_FILTERS);
    const [start, setStart] = useState(0);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

    const queryParams = useMemo(
        () => toListParams(activeFilters, start),
        [activeFilters, start],
    );

    const { data, isLoading, isError, error } = useQuery(auditLogQueryOptions(queryParams));

    const handleChange = useCallback(
        <K extends keyof Filters>(key: K, value: Filters[K]) => {
            setDraftFilters((prev) => ({ ...prev, [key]: value }));
        },
        [],
    );

    const handleApply = useCallback(() => {
        setActiveFilters(draftFilters);
        setStart(0);
        setExpanded(new Set());
    }, [draftFilters]);

    const handleReset = useCallback(() => {
        setDraftFilters(EMPTY_FILTERS);
        setActiveFilters(EMPTY_FILTERS);
        setStart(0);
        setExpanded(new Set());
    }, []);

    const handleToggle = useCallback((id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handlePrev = useCallback(() => {
        setStart((prev) => Math.max(0, prev - DEFAULT_COUNT));
        setExpanded(new Set());
    }, []);

    const handleNext = useCallback(() => {
        setStart((prev) => prev + DEFAULT_COUNT);
        setExpanded(new Set());
    }, []);

    const total = data?.total ?? 0;
    const hits = data?.hits ?? [];
    const page = Math.floor(start / DEFAULT_COUNT) + 1;
    const totalPages = Math.max(1, Math.ceil(total / DEFAULT_COUNT));
    const canPrev = start > 0;
    const canNext = start + DEFAULT_COUNT < total;

    return (
        <div data-component={AUDIT_PAGE_NAME} className="flex h-full flex-col">
            {/* Header */}
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 overflow-x-auto border-border border-b bg-card px-4">
                <span className="font-medium font-mono text-foreground text-xs">
                    Audit Log
                </span>
                <span className="text-muted-foreground text-xs">
                    {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}
                    {hits.length > 0 && ` · showing ${hits.length}`}
                </span>
            </div>

            {/* Filter toolbar */}
            <div className="flex flex-wrap items-end gap-3 border-border border-b bg-card px-4 py-2">
                <FilterField label="From" htmlFor="audit-from">
                    <Input
                        id="audit-from"
                        type="date"
                        value={draftFilters.from}
                        onChange={(e) => handleChange('from', e.target.value)}
                        className="h-8 w-[10rem]"
                    />
                </FilterField>
                <FilterField label="To" htmlFor="audit-to">
                    <Input
                        id="audit-to"
                        type="date"
                        value={draftFilters.to}
                        onChange={(e) => handleChange('to', e.target.value)}
                        className="h-8 w-[10rem]"
                    />
                </FilterField>
                <FilterField label="Type" htmlFor="audit-type">
                    <Input
                        id="audit-type"
                        placeholder="system.content.publish"
                        value={draftFilters.type}
                        onChange={(e) => handleChange('type', e.target.value)}
                        className="h-8 w-[16rem]"
                    />
                </FilterField>
                <FilterField label="User" htmlFor="audit-user">
                    <Input
                        id="audit-user"
                        placeholder="user:system:su"
                        value={draftFilters.user}
                        onChange={(e) => handleChange('user', e.target.value)}
                        className="h-8 w-[14rem]"
                    />
                </FilterField>
                <FilterField label="Source" htmlFor="audit-source">
                    <Input
                        id="audit-source"
                        placeholder="com.enonic.xp.*"
                        value={draftFilters.source}
                        onChange={(e) => handleChange('source', e.target.value)}
                        className="h-8 w-[14rem]"
                    />
                </FilterField>
                <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={handleReset}>
                        Reset
                    </Button>
                    <Button size="sm" onClick={handleApply}>
                        Apply
                    </Button>
                </div>
            </div>

            {/* Table */}
            <AuditBody
                isLoading={isLoading}
                isError={isError}
                error={error}
                hits={hits}
                expanded={expanded}
                onToggle={handleToggle}
            />

            {/* Pagination */}
            {total > 0 && (
                <div className="flex shrink-0 items-center justify-end gap-2 border-border border-t bg-card px-4 py-2">
                    <span className="text-muted-foreground text-xs">
                        Page {page} of {totalPages}
                    </span>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handlePrev}
                        disabled={!canPrev}
                    >
                        <ChevronLeft className="size-4" />
                        Previous
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleNext}
                        disabled={!canNext}
                    >
                        Next
                        <ChevronRight className="size-4" />
                    </Button>
                </div>
            )}
        </div>
    );
};

AuditPage.displayName = AUDIT_PAGE_NAME;

//
// * FilterField
//

type FilterFieldProps = {
    label: string;
    htmlFor: string;
    children: ReactElement;
};

const FilterField = ({ label, htmlFor, children }: FilterFieldProps): ReactElement => {
    return (
        <div className="flex flex-col gap-1">
            <Label htmlFor={htmlFor} className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {label}
            </Label>
            {children}
        </div>
    );
};

FilterField.displayName = 'FilterField';

//
// * AuditBody
//

type AuditBodyProps = {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    hits: AuditEntry[];
    expanded: Set<string>;
    onToggle: (id: string) => void;
};

const AuditBody = ({
    isLoading,
    isError,
    error,
    hits,
    expanded,
    onToggle,
}: AuditBodyProps): ReactElement => {
    if (isError) {
        const message =
            error != null && typeof error === 'object' && 'message' in error
                ? String((error as { message: unknown }).message)
                : 'Failed to load audit log.';
        return (
            <EmptyState
                icon={Shield}
                title="Failed to load audit log"
                description={message}
            />
        );
    }

    if (isLoading) {
        return (
            <div className="flex-1 overflow-auto">
                <div className="flex flex-col gap-2 px-4 py-3">
                    {SKELETON_KEYS.map((key) => (
                        <Skeleton key={key} className="h-8 w-full" />
                    ))}
                </div>
            </div>
        );
    }

    if (hits.length === 0) {
        return (
            <EmptyState
                icon={Shield}
                title="No audit entries"
                description="No entries match the current filters."
            />
        );
    }

    return (
        <div className="flex-1 overflow-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Time</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Objects</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {hits.map((entry) => (
                        <AuditRow
                            key={entry._id}
                            entry={entry}
                            expanded={expanded.has(entry._id)}
                            onToggle={onToggle}
                        />
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};

AuditBody.displayName = 'AuditBody';

export const Route = createFileRoute('/audit')({
    component: AuditPage,
});
