import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from '@tanstack/react-table';
import { ListTodo } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, type BadgeProps } from '../components/ui/badge';
import { EmptyState } from '../components/ui/empty-state';
import { Progress } from '../components/ui/progress';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '../components/ui/table';
import { type TaskInfo, type TaskState, tasksListQueryOptions } from '../lib/api/tasks';
import { useTasksListRefresh } from '../lib/hooks/use-task-progress';
import { useWebSocket } from '../lib/hooks/use-websocket';

const TASKS_PAGE_NAME = 'TasksPage';

const TASK_STATE_VARIANT: Record<TaskState, BadgeProps['variant']> = {
    WAITING: 'outline',
    RUNNING: 'default',
    FINISHED: 'secondary',
    FAILED: 'destructive',
};

function formatDuration(startIso: string, state: TaskState): string {
    const start = new Date(startIso).getTime();
    if (Number.isNaN(start)) return '-';
    const elapsed = state === 'FINISHED' || state === 'FAILED' ? 0 : Date.now() - start;
    if (state === 'FINISHED' || state === 'FAILED') return '-';
    const seconds = Math.max(0, Math.floor(elapsed / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rem = seconds % 60;
    return `${minutes}m ${rem}s`;
}

function formatStartTime(startIso: string): string {
    try {
        return new Date(startIso).toLocaleString();
    } catch {
        return startIso;
    }
}

function computePercent({ current, total }: TaskInfo['progress']): number {
    if (total <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
}

const columnHelper = createColumnHelper<TaskInfo>();

const TasksPage = (): ReactElement => {
    const { t } = useTranslation();
    const { data: tasks } = useSuspenseQuery(tasksListQueryOptions());
    const { status } = useWebSocket();
    useTasksListRefresh();

    const columns = [
        columnHelper.accessor('name', {
            header: t('task.column.name'),
            cell: info => (
                <div className="flex flex-col">
                    <span className="font-medium text-foreground">{info.getValue()}</span>
                    {info.row.original.description !== '' && (
                        <span className="text-muted-foreground text-xs">
                            {info.row.original.description}
                        </span>
                    )}
                </div>
            ),
        }),
        columnHelper.accessor('state', {
            header: t('task.column.state'),
            cell: info => (
                <Badge variant={TASK_STATE_VARIANT[info.getValue()]}>
                    {info.getValue()}
                </Badge>
            ),
        }),
        columnHelper.accessor('progress', {
            header: t('task.column.progress'),
            cell: info => {
                const { progress, state } = info.row.original;
                const percent = computePercent(progress);
                return (
                    <div className="flex min-w-40 flex-col gap-1">
                        <Progress value={state === 'FINISHED' ? 100 : percent} />
                        <span className="text-muted-foreground text-xs">
                            {progress.info !== ''
                                ? progress.info
                                : `${progress.current}/${progress.total}`}
                        </span>
                    </div>
                );
            },
        }),
        columnHelper.accessor('startTime', {
            header: t('task.column.started'),
            cell: info => (
                <span className="font-mono text-muted-foreground text-xs">
                    {formatStartTime(info.getValue())}
                </span>
            ),
        }),
        columnHelper.display({
            id: 'duration',
            header: t('task.column.duration'),
            cell: info => (
                <span className="font-mono text-muted-foreground text-xs">
                    {formatDuration(info.row.original.startTime, info.row.original.state)}
                </span>
            ),
        }),
    ];

    const table = useReactTable({
        data: tasks,
        columns,
        getCoreRowModel: getCoreRowModel(),
    });

    const wsLabel =
        status === 'open'
            ? t('events.status.live')
            : status === 'connecting'
              ? t('events.status.connecting')
              : t('events.status.offline');
    const wsVariant: BadgeProps['variant'] =
        status === 'open' ? 'default' : status === 'connecting' ? 'outline' : 'destructive';

    return (
        <div data-component={TASKS_PAGE_NAME} className="flex flex-col">
            <div className="flex h-10 shrink-0 items-center justify-between gap-1.5 overflow-x-auto border-border border-b bg-card px-4">
                <span className="font-medium font-mono text-foreground text-xs">{t('nav.tasks')}</span>
                <Badge variant={wsVariant}>{wsLabel}</Badge>
            </div>

            {tasks.length === 0 ? (
                <EmptyState
                    icon={ListTodo}
                    title={t('task.empty.title')}
                    description={t('task.empty.description')}
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
        </div>
    );
};

TasksPage.displayName = TASKS_PAGE_NAME;

export const Route = createFileRoute('/tasks')({
    loader: ({ context: { queryClient } }) =>
        queryClient.ensureQueryData(tasksListQueryOptions()),
    component: TasksPage,
});
