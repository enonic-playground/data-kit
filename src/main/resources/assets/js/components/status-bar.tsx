import { useRouterState } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { cn } from '../lib/utils';

const ROUTE_STATUS: Record<string, string> = {
    '/repositories': 'Node store',
    '/search': 'Full-text search across all repositories',
    '/snapshots': 'Snapshots',
    '/dumps': 'Dumps',
    '/exports': 'Exports',
    '/tasks': 'Tasks',
    '/audit': 'Audit log',
    '/events': 'Events',
    '/system': 'System info',
};

function getStatusText(pathname: string): string {
    for (const [route, label] of Object.entries(ROUTE_STATUS)) {
        if (pathname.startsWith(route)) return label;
    }
    return 'Ready';
}

export type StatusBarProps = {
    className?: string;
};

const STATUS_BAR_NAME = 'StatusBar';

export const StatusBar = ({ className }: StatusBarProps): ReactElement => {
    const routerState = useRouterState();
    const statusText = getStatusText(routerState.location.pathname);

    const barClasses = cn(
        'flex h-6 shrink-0 items-center bg-primary px-3.5',
        className,
    );

    return (
        <div data-component={STATUS_BAR_NAME} className={barClasses}>
            <div className="flex items-center gap-1.5">
                <div className="size-1 rounded-full bg-white/55" />
                <span className="font-mono text-white/88 text-xs tracking-wide">
                    {statusText}
                </span>
            </div>
            <div className="flex-1" />
            <span className="font-mono text-white/45 text-xs tracking-wider">
                admin
            </span>
        </div>
    );
};

StatusBar.displayName = STATUS_BAR_NAME;
