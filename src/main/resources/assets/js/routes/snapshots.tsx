import { createFileRoute } from '@tanstack/react-router';
import { Camera } from 'lucide-react';
import type { ReactElement } from 'react';
import { EmptyState } from '../components/ui/empty-state';

const SNAPSHOTS_PAGE_NAME = 'SnapshotsPage';

const SnapshotsPage = (): ReactElement => {
    return (
        <div
            data-component={SNAPSHOTS_PAGE_NAME}
            className="flex h-full items-center justify-center"
        >
            <EmptyState
                icon={Camera}
                title="Snapshots"
                description="Snapshot management coming soon."
            />
        </div>
    );
};

SnapshotsPage.displayName = SNAPSHOTS_PAGE_NAME;

export const Route = createFileRoute('/snapshots')({
    component: SnapshotsPage,
});
