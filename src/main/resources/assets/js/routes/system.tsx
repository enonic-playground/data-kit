import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { systemInfoQueryOptions } from '../lib/api/system';

const SYSTEM_PAGE_NAME = 'SystemPage';

const SystemPage = (): ReactElement => {
    const { data: systemInfo } = useSuspenseQuery(systemInfoQueryOptions());

    return (
        <div data-component={SYSTEM_PAGE_NAME} className="flex flex-col gap-4">
            <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-4 pt-4 text-sm">
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
