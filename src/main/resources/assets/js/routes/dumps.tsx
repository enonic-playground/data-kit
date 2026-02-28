import { createFileRoute } from '@tanstack/react-router';
import { HardDrive } from 'lucide-react';
import type { ReactElement } from 'react';
import { EmptyState } from '../components/ui/empty-state';

const DUMPS_PAGE_NAME = 'DumpsPage';

const DumpsPage = (): ReactElement => {
    return (
        <div
            data-component={DUMPS_PAGE_NAME}
            className="flex h-full items-center justify-center"
        >
            <EmptyState
                icon={HardDrive}
                title="Dumps"
                description="Dump management coming soon."
            />
        </div>
    );
};

DumpsPage.displayName = DUMPS_PAGE_NAME;

export const Route = createFileRoute('/dumps')({
    component: DumpsPage,
});
