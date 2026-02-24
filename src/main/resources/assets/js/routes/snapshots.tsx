import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

const SNAPSHOTS_PAGE_NAME = 'SnapshotsPage';

const SnapshotsPage = (): ReactElement => {
    return (
        <div data-component={SNAPSHOTS_PAGE_NAME} className="p-6">
            <h2 className="font-semibold text-2xl">Snapshots</h2>
            <p className="mt-2 text-muted-foreground">
                Manage snapshots here.
            </p>
        </div>
    );
};

SnapshotsPage.displayName = SNAPSHOTS_PAGE_NAME;

export const Route = createFileRoute('/snapshots')({
    component: SnapshotsPage,
});
