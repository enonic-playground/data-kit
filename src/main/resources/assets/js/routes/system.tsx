import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { systemInfoQueryOptions } from '../lib/api/system';

const SYSTEM_PAGE_NAME = 'SystemPage';

const SystemPage = (): ReactElement => {
    const { data: systemInfo } = useSuspenseQuery(systemInfoQueryOptions());

    return (
        <div data-component={SYSTEM_PAGE_NAME} className="p-6">
            <h2 className="font-semibold text-2xl">System</h2>
            <p className="mt-2 text-muted-foreground">
                View system information here.
            </p>
            <dl className="mt-6 grid max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="font-medium text-muted-foreground">XP Version</dt>
                <dd>{systemInfo.xpVersion}</dd>
                <dt className="font-medium text-muted-foreground">App Version</dt>
                <dd>{systemInfo.appVersion}</dd>
                <dt className="font-medium text-muted-foreground">App Name</dt>
                <dd className="font-mono text-xs">{systemInfo.appName}</dd>
            </dl>
        </div>
    );
};

SystemPage.displayName = SYSTEM_PAGE_NAME;

export const Route = createFileRoute('/system')({
    loader: ({ context: { queryClient } }) =>
        queryClient.ensureQueryData(systemInfoQueryOptions()),
    component: SystemPage,
});
