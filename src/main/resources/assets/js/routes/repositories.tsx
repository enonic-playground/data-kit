import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

const REPOSITORIES_PAGE_NAME = 'RepositoriesPage';

const RepositoriesPage = (): ReactElement => {
    return (
        <div data-component={REPOSITORIES_PAGE_NAME} className="p-6">
            <h2 className="font-semibold text-2xl">Repositories</h2>
            <p className="mt-2 text-muted-foreground">
                Manage repositories here.
            </p>
        </div>
    );
};

RepositoriesPage.displayName = REPOSITORIES_PAGE_NAME;

export const Route = createFileRoute('/repositories')({
    component: RepositoriesPage,
});
