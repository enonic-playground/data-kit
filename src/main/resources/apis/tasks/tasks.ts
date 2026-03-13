import type { Request, Response } from '@enonic-types/core';
import { get as getTask } from '/lib/xp/task';
import { errorResponse, getParam, jsonResponse, requireAdmin } from '../../lib/api';

export function get(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    const taskId = getParam(req, 'taskId');
    if (taskId == null) {
        return errorResponse(400, 'taskId is required', 'VALIDATION_ERROR');
    }

    const task = getTask(taskId);
    if (task == null) {
        return errorResponse(404, `Task '${taskId}' not found`, 'NOT_FOUND');
    }

    return jsonResponse(task);
}
