import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

const SYSTEM_PAGE_NAME = 'SystemPage';

const SystemPage = (): ReactElement => {
    return (
        <div data-component={SYSTEM_PAGE_NAME} className="p-6">
            <h2 className="font-semibold text-2xl">System</h2>
            <p className="mt-2 text-muted-foreground">
                View system information here.
            </p>
        </div>
    );
};

SystemPage.displayName = SYSTEM_PAGE_NAME;

export const Route = createFileRoute('/system')({
    component: SystemPage,
});
