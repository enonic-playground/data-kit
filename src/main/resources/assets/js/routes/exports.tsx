import { createFileRoute } from '@tanstack/react-router';
import { FileOutput } from 'lucide-react';
import type { ReactElement } from 'react';
import { EmptyState } from '../components/ui/empty-state';

const EXPORTS_PAGE_NAME = 'ExportsPage';

const ExportsPage = (): ReactElement => {
    return (
        <div
            data-component={EXPORTS_PAGE_NAME}
            className="flex h-full items-center justify-center"
        >
            <EmptyState
                icon={FileOutput}
                title="Exports"
                description="Export and import management coming soon."
            />
        </div>
    );
};

ExportsPage.displayName = EXPORTS_PAGE_NAME;

export const Route = createFileRoute('/exports')({
    component: ExportsPage,
});
