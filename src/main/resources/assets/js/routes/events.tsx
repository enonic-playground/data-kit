import { createFileRoute } from '@tanstack/react-router';
import { Activity } from 'lucide-react';
import type { ReactElement } from 'react';
import { EmptyState } from '../components/ui/empty-state';

const EVENTS_PAGE_NAME = 'EventsPage';

const EventsPage = (): ReactElement => {
    return (
        <div
            data-component={EVENTS_PAGE_NAME}
            className="flex h-full items-center justify-center"
        >
            <EmptyState
                icon={Activity}
                title="Events"
                description="Real-time event stream coming soon."
            />
        </div>
    );
};

EventsPage.displayName = EVENTS_PAGE_NAME;

export const Route = createFileRoute('/events')({
    component: EventsPage,
});
