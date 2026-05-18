import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Shield } from 'lucide-react';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import { type AuditEntry, type AuditListParams, auditLogQueryOptions } from '../lib/api/audit';
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
              'text-muted-foreground size-3.5 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        </TableCell>
        <TableCell className="text-xs whitespace-nowrap">{formatTimestamp(entry.time)}</TableCell>
        <TableCell>
          <Badge variant="secondary">{entry.type}</Badge>
        </TableCell>
        <TableCell className="text-xs">{entry.user || '—'}</TableCell>
        <TableCell className="text-muted-foreground text-xs">{entry.source || '—'}</TableCell>
        <TableCell className="text-muted-foreground max-w-[320px] truncate text-xs">
          {formatObjects(entry.objects)}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={6} className="bg-muted/40 p-0 font-sans">
            <pre className="text-foreground overflow-x-auto px-4 py-3 font-mono text-xs">
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
  const { t } = useTranslation();
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [activeFilters, setActiveFilters] = useState<Filters>(EMPTY_FILTERS);
  const [start, setStart] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const queryParams = useMemo(() => toListParams(activeFilters, start), [activeFilters, start]);

  const { data, isLoading, isError, error } = useQuery(auditLogQueryOptions(queryParams));

  const handleChange = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setDraftFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

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
      <div className="border-border bg-card flex h-10 shrink-0 items-center justify-between gap-2 overflow-x-auto border-b px-4">
        <span className="text-foreground font-mono text-xs font-medium">{t('audit.title')}</span>
        <span className="text-muted-foreground text-xs">
          {t('audit.entries', { count: total, total: total.toLocaleString() })}
          {hits.length > 0 && ` · ${t('audit.showing', { count: hits.length })}`}
        </span>
      </div>

      {/* Filter toolbar */}
      <div className="border-border bg-card flex flex-wrap items-end gap-3 border-b px-4 py-2">
        <FilterField label={t('audit.filter.from')} htmlFor="audit-from">
          <Input
            id="audit-from"
            type="date"
            value={draftFilters.from}
            onChange={(e) => handleChange('from', e.target.value)}
            className="h-8 w-[10rem]"
          />
        </FilterField>
        <FilterField label={t('audit.filter.to')} htmlFor="audit-to">
          <Input
            id="audit-to"
            type="date"
            value={draftFilters.to}
            onChange={(e) => handleChange('to', e.target.value)}
            className="h-8 w-[10rem]"
          />
        </FilterField>
        <FilterField label={t('audit.filter.type')} htmlFor="audit-type">
          <Input
            id="audit-type"
            placeholder="system.content.publish"
            value={draftFilters.type}
            onChange={(e) => handleChange('type', e.target.value)}
            className="h-8 w-[16rem]"
          />
        </FilterField>
        <FilterField label={t('audit.filter.user')} htmlFor="audit-user">
          <Input
            id="audit-user"
            placeholder="user:system:su"
            value={draftFilters.user}
            onChange={(e) => handleChange('user', e.target.value)}
            className="h-8 w-[14rem]"
          />
        </FilterField>
        <FilterField label={t('audit.filter.source')} htmlFor="audit-source">
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
            {t('common.action.reset')}
          </Button>
          <Button size="sm" onClick={handleApply}>
            {t('common.action.apply')}
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
        <div className="border-border bg-card flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2">
          <span className="text-muted-foreground text-xs">
            {t('common.pagination.page', { page, total: totalPages })}
          </span>
          <Button size="sm" variant="ghost" onClick={handlePrev} disabled={!canPrev}>
            <ChevronLeft className="size-4" />
            {t('common.pagination.previous')}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleNext} disabled={!canNext}>
            {t('common.pagination.next')}
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
      <Label
        htmlFor={htmlFor}
        className="text-muted-foreground text-[10px] tracking-wider uppercase"
      >
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
  const { t } = useTranslation();
  if (isError) {
    const message =
      error != null && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : t('audit.error.loadFailed');
    return (
      <EmptyState icon={Shield} title={t('audit.error.loadFailed.title')} description={message} />
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
        title={t('audit.empty.title')}
        description={t('audit.empty.description')}
      />
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>{t('audit.column.time')}</TableHead>
            <TableHead>{t('audit.column.type')}</TableHead>
            <TableHead>{t('audit.column.user')}</TableHead>
            <TableHead>{t('audit.column.source')}</TableHead>
            <TableHead>{t('audit.column.objects')}</TableHead>
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
