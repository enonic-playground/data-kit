import type { Request } from '@enonic-types/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('/lib/xp/auth', () => ({
    hasRole: vi.fn(() => true),
}));

vi.mock('/lib/xp/task', () => ({
    get: vi.fn(),
    list: vi.fn(() => []),
}));

import { hasRole } from '/lib/xp/auth';
import { get as getTask, list as listTasks } from '/lib/xp/task';
import { get } from '../../main/resources/apis/tasks/tasks';

const mockedHasRole = vi.mocked(hasRole);
const mockedGetTask = vi.mocked(getTask);
const mockedListTasks = vi.mocked(listTasks);

beforeEach(() => {
    vi.clearAllMocks();
    mockedHasRole.mockReturnValue(true);
});

function parseBody(response: { body?: string | object }) {
    return JSON.parse(response.body as string);
}

describe('GET /tasks', () => {
    test('returns task info', () => {
        const task = {
            id: 'task-123',
            name: 'dump',
            state: 'RUNNING',
            progress: { current: 5, total: 10, info: 'Processing...' },
        };
        mockedGetTask.mockReturnValue(task as ReturnType<typeof getTask>);

        const response = get({
            params: { taskId: 'task-123' },
        } as unknown as Request);
        const body = parseBody(response);

        expect(response.status).toBe(200);
        expect(body.data).toEqual(task);
        expect(mockedGetTask).toHaveBeenCalledWith('task-123');
    });

    test('returns task list when taskId is missing', () => {
        const tasks = [
            {
                id: 'task-1',
                name: 'dump',
                state: 'RUNNING',
                progress: { current: 1, total: 10, info: '' },
            },
        ];
        mockedListTasks.mockReturnValue(tasks as ReturnType<typeof listTasks>);

        const response = get({
            params: {},
        } as unknown as Request);

        expect(response.status).toBe(200);
        expect(parseBody(response).data).toEqual(tasks);
        expect(mockedListTasks).toHaveBeenCalledWith({ name: null, state: null });
    });

    test('returns 404 when task not found', () => {
        mockedGetTask.mockReturnValue(null as unknown as ReturnType<typeof getTask>);

        const response = get({
            params: { taskId: 'nonexistent' },
        } as unknown as Request);
        expect(response.status).toBe(404);
        expect(parseBody(response).code).toBe('NOT_FOUND');
    });

    test('returns 403 for non-admin', () => {
        mockedHasRole.mockReturnValue(false);
        const response = get({
            params: { taskId: 'task-123' },
        } as unknown as Request);
        expect(response.status).toBe(403);
    });
});
