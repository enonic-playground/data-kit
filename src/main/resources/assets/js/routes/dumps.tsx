import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

const DUMPS_PAGE_NAME = 'DumpsPage';

const DumpsPage = (): ReactElement => {
    return (
        <div data-component={DUMPS_PAGE_NAME} className="p-6">
            <h2 className="font-semibold text-2xl">Dumps</h2>
            <p className="mt-2 text-muted-foreground">
                Manage dumps here.
            </p>
        </div>
    );
};

DumpsPage.displayName = DUMPS_PAGE_NAME;

export const Route = createFileRoute('/dumps')({
    component: DumpsPage,
});
