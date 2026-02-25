import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

const REPOSITORY_DETAIL_PAGE_NAME = 'RepositoryDetailPage';

const RepositoryDetailPage = (): ReactElement => {
    const { repoId } = Route.useParams();

    return (
        <div data-component={REPOSITORY_DETAIL_PAGE_NAME} className="p-6">
            <h2 className="font-semibold text-2xl">{repoId}</h2>
            <p className="mt-2 text-muted-foreground">
                Repository details and branches will be displayed here.
            </p>
        </div>
    );
};

RepositoryDetailPage.displayName = REPOSITORY_DETAIL_PAGE_NAME;

export const Route = createFileRoute('/repositories/$repoId')({
    component: RepositoryDetailPage,
});
