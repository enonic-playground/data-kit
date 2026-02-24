import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

const EVENTS_PAGE_NAME = 'EventsPage';

const EventsPage = (): ReactElement => {
    return (
        <div data-component={EVENTS_PAGE_NAME} className="p-6">
            <h2 className="font-semibold text-2xl">Events</h2>
            <p className="mt-2 text-muted-foreground">
                View real-time event stream here.
            </p>
        </div>
    );
};

EventsPage.displayName = EVENTS_PAGE_NAME;

export const Route = createFileRoute('/events')({
    component: EventsPage,
});
