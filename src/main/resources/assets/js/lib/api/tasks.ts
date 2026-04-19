import { queryOptions } from '@tanstack/react-query';
import { getConfig } from '../config';
import { apiFetch } from './client';

type TaskProgress = {
    current: number;
    total: number;
    info: string;
};

export type TaskState = 'WAITING' | 'RUNNING' | 'FINISHED' | 'FAILED';

export type TaskInfo = {
    id: string;
    name: string;
    description: string;
    state: TaskState;
    application: string;
    user: string;
    startTime: string;
    progress: TaskProgress;
    node?: string;
};

const TERMINAL_STATES: TaskState[] = ['FINISHED', 'FAILED'];

export function isTerminalState(state: TaskState | undefined): boolean {
    return state != null && TERMINAL_STATES.includes(state);
}

export function fetchTask(taskId: string): Promise<TaskInfo> {
    const { apiUris } = getConfig();
    return apiFetch<TaskInfo>(apiUris.tasks, {
        params: { taskId },
    });
}

export function fetchTasks(): Promise<TaskInfo[]> {
    const { apiUris } = getConfig();
    return apiFetch<TaskInfo[]>(apiUris.tasks);
}

export function taskQueryOptions(taskId: string | undefined) {
    return queryOptions({
        queryKey: ['tasks', taskId],
        queryFn: () => fetchTask(taskId as string),
        enabled: taskId != null,
        refetchInterval: (query) => {
            const state = query.state.data?.state;
            if (isTerminalState(state)) return false;
            return 1500;
        },
    });
}

export function tasksListQueryOptions() {
    return queryOptions({
        queryKey: ['tasks', 'list'],
        queryFn: fetchTasks,
        refetchInterval: 5000,
    });
}
