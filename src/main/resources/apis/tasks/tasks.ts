import { get as getTask, list as listTasks, type TaskStateType } from '/lib/xp/task';

import type { Request, Response } from '@enonic-types/core';

import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';

const ALLOWED_STATES: TaskStateType[] = ['WAITING', 'RUNNING', 'FINISHED', 'FAILED'];

function isTaskState(value: string): value is TaskStateType {
  return ALLOWED_STATES.indexOf(value as TaskStateType) >= 0;
}

export function get(req: Request): Response {
  const forbidden = requireAdmin();
  if (forbidden != null) return forbidden;

  const taskId = getParam(req, 'taskId');
  if (taskId != null) {
    const task = getTask(taskId);
    if (task == null) {
      return errorResponse(404, `Task '${taskId}' not found`, 'NOT_FOUND');
    }
    return jsonResponse(task);
  }

  const stateParam = getParam(req, 'state');
  const state = stateParam != null && isTaskState(stateParam) ? stateParam : undefined;
  const name = getParam(req, 'name');

  try {
    const tasks = listTasks({ name: name ?? null, state: state ?? null });
    return jsonResponse(tasks);
  } catch (e) {
    return errorResponse(500, String(e), 'INTERNAL_ERROR');
  }
}
