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
    state: TaskState;
    progress: TaskProgress;
};

export function fetchTask(taskId: string): Promise<TaskInfo> {
    const { apiUris } = getConfig();
    return apiFetch<TaskInfo>(apiUris.tasks, {
        params: { taskId },
    });
}

const TERMINAL_STATES: TaskState[] = ['FINISHED', 'FAILED'];

export function taskQueryOptions(taskId: string | undefined) {
    return queryOptions({
        queryKey: ['tasks', taskId],
        queryFn: () => fetchTask(taskId as string),
        enabled: taskId != null,
        refetchInterval: (query) => {
            const state = query.state.data?.state;
            if (state != null && TERMINAL_STATES.includes(state)) return false;
            return 1500;
        },
    });
}
