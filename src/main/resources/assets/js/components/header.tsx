import { useRouterState } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { ThemeToggle } from './theme-toggle';

const ROUTE_TITLE_KEYS: Record<string, string> = {
    '/repositories': 'nav.repositories',
    '/search': 'nav.search',
    '/snapshots': 'nav.snapshots',
    '/dumps': 'nav.dumps',
    '/exports': 'nav.exports',
    '/tasks': 'nav.tasks',
    '/audit': 'nav.audit',
    '/events': 'nav.events',
    '/system': 'nav.system',
};

function getPageTitleKey(pathname: string): string {
    for (const [route, key] of Object.entries(ROUTE_TITLE_KEYS)) {
        if (pathname.startsWith(route)) return key;
    }
    return 'common.appName';
}

export type HeaderProps = {
    className?: string;
};

const HEADER_NAME = 'Header';

export const Header = ({ className }: HeaderProps): ReactElement => {
    const { t } = useTranslation();
    const routerState = useRouterState();
    const pageTitle = t(getPageTitleKey(routerState.location.pathname));

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
