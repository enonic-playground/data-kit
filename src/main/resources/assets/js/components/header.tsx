import { useRouterState } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { cn } from '../lib/utils';
import { ThemeToggle } from './theme-toggle';

const ROUTE_LABELS: Record<string, string> = {
    '/repositories': 'Repositories',
    '/search': 'Search',
    '/snapshots': 'Snapshots',
    '/dumps': 'Dumps',
    '/exports': 'Exports',
    '/tasks': 'Tasks',
    '/audit': 'Audit',
    '/events': 'Events',
    '/system': 'System',
};

function getPageTitle(pathname: string): string {
    for (const [route, label] of Object.entries(ROUTE_LABELS)) {
        if (pathname.startsWith(route)) {
            return label;
        }
    }
    return 'Data Kit';
}

export type HeaderProps = {
    className?: string;
};

const HEADER_NAME = 'Header';

export const Header = ({ className }: HeaderProps): ReactElement => {
    const routerState = useRouterState();
    const pageTitle = getPageTitle(routerState.location.pathname);

    const headerClasses = cn(
        'flex h-14 shrink-0 items-center justify-between border-border border-b bg-card px-6',
        className,
    );

    return (
        <header data-component={HEADER_NAME} className={headerClasses}>
            <div className="flex items-center gap-2">
                <h1 className="font-semibold text-foreground text-lg">
                    {pageTitle}
                </h1>
            </div>
            <div className="flex items-center gap-2">
                <ThemeToggle />
            </div>
        </header>
    );
};

Header.displayName = HEADER_NAME;
