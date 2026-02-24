import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

const TASKS_PAGE_NAME = 'TasksPage';

const TasksPage = (): ReactElement => {
    return (
        <div data-component={TASKS_PAGE_NAME} className="p-6">
            <h2 className="font-semibold text-2xl">Tasks</h2>
            <p className="mt-2 text-muted-foreground">
                Monitor running tasks here.
            </p>
        </div>
    );
};

TasksPage.displayName = TASKS_PAGE_NAME;

export const Route = createFileRoute('/tasks')({
    component: TasksPage,
});
