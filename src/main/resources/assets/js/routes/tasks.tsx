import { createFileRoute } from '@tanstack/react-router';
import { ListTodo } from 'lucide-react';
import type { ReactElement } from 'react';
import { EmptyState } from '../components/ui/empty-state';

const TASKS_PAGE_NAME = 'TasksPage';

const TasksPage = (): ReactElement => {
    return (
        <div
            data-component={TASKS_PAGE_NAME}
            className="flex h-full items-center justify-center"
        >
            <EmptyState
                icon={ListTodo}
                title="Tasks"
                description="Task monitoring coming soon."
            />
        </div>
    );
};

TasksPage.displayName = TASKS_PAGE_NAME;

export const Route = createFileRoute('/tasks')({
    component: TasksPage,
});
