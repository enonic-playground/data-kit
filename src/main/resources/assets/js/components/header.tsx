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
        'flex h-12 shrink-0 items-center justify-between border-border border-b bg-card px-5',
        className,
    );

    return (
        <header data-component={HEADER_NAME} className={headerClasses}>
            <h1 className="font-semibold text-foreground text-sm">
                {pageTitle}
            </h1>
            <ThemeToggle />
        </header>
    );
};

Header.displayName = HEADER_NAME;
