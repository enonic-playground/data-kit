import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

const EXPORTS_PAGE_NAME = 'ExportsPage';

const ExportsPage = (): ReactElement => {
    return (
        <div data-component={EXPORTS_PAGE_NAME} className="p-6">
            <h2 className="font-semibold text-2xl">Exports</h2>
            <p className="mt-2 text-muted-foreground">
                Manage exports and imports here.
            </p>
        </div>
    );
};

ExportsPage.displayName = EXPORTS_PAGE_NAME;

export const Route = createFileRoute('/exports')({
    component: ExportsPage,
});
