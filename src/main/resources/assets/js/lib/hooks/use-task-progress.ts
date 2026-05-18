import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { ServerMessage } from '../websocket';

import { isTerminalState, type TaskInfo, type TaskState } from '../api/tasks';
import { isEventMessage, useWebSocket } from './use-websocket';

type TaskEventData = {
  id?: string;
  taskId?: string;
  name?: string;
  state?: TaskState;
  progress?: {
    current?: number;
    total?: number;
    info?: string;
  };
};

const TASK_EVENT_PREFIX = 'task.';

function extractTaskId(event: { type: string; data: Record<string, unknown> }): string | undefined {
  const data = event.data as TaskEventData;
  return data.id ?? data.taskId;
}

function toTaskStateFromType(type: string): TaskState | undefined {
  switch (type) {
    case 'task.submitted':
      return 'WAITING';
    case 'task.updated':
      return 'RUNNING';
    case 'task.finished':
      return 'FINISHED';
    case 'task.failed':
      return 'FAILED';
    default:
      return undefined;
  }
}

function applyEventToTask(
  existing: TaskInfo | undefined,
  event: {
    type: string;
    timestamp: number;
    data: Record<string, unknown>;
  },
): TaskInfo | undefined {
  const data = event.data as TaskEventData;
  const derivedState = toTaskStateFromType(event.type);
  const nextState = data.state ?? derivedState ?? existing?.state;
  if (existing == null && nextState == null) return undefined;

  const progress: TaskInfo['progress'] = {
    current: data.progress?.current ?? existing?.progress.current ?? 0,
    total: data.progress?.total ?? existing?.progress.total ?? 0,
    info: data.progress?.info ?? existing?.progress.info ?? '',
  };

  const id = data.id ?? data.taskId ?? existing?.id ?? '';
  const base: TaskInfo = existing ?? {
    id,
    name: data.name ?? '',
    description: '',
    state: nextState ?? 'WAITING',
    application: '',
    user: '',
    startTime: new Date(event.timestamp).toISOString(),
    progress,
  };

  return {
    ...base,
    id,
    name: data.name ?? base.name,
    state: nextState ?? base.state,
    progress,
  };
}

export function useTaskProgress(taskId: string | undefined): void {
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocket();

  useEffect(() => {
    if (taskId == null) return;

    const unsubscribe = subscribe((message: ServerMessage) => {
      if (!isEventMessage(message)) return;
      if (!message.type.startsWith(TASK_EVENT_PREFIX)) return;

      const eventTaskId = extractTaskId(message);
      if (eventTaskId !== taskId) return;

      queryClient.setQueryData<TaskInfo | undefined>(['tasks', taskId], (existing) =>
        applyEventToTask(existing, message),
      );

      const state = (message.data as TaskEventData).state ?? toTaskStateFromType(message.type);
      if (isTerminalState(state)) {
        queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] });
      }
    });

    return unsubscribe;
  }, [queryClient, subscribe, taskId]);
}

export function useTasksListRefresh(): void {
  const queryClient = useQueryClient();
  const { subscribe } = useWebSocket();

  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (!isEventMessage(message)) return;
      if (!message.type.startsWith(TASK_EVENT_PREFIX)) return;
      queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] });
    });
    return unsubscribe;
  }, [queryClient, subscribe]);
}
