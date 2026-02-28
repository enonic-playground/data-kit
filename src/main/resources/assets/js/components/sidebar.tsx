import { Link, useRouterState } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import {
    Activity,
    Camera,
    Database,
    FileOutput,
    HardDrive,
    ListTodo,
    PanelRightClose,
    PanelRightOpen,
    Search,
    Settings,
    Shield,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { cn } from '../lib/utils';

type NavItem = {
    to: string;
    label: string;
    icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
    { to: '/repositories', label: 'Repositories', icon: Database },
    { to: '/search', label: 'Search', icon: Search },
    { to: '/snapshots', label: 'Snapshots', icon: Camera },
    { to: '/dumps', label: 'Dumps', icon: HardDrive },
    { to: '/exports', label: 'Exports', icon: FileOutput },
    { to: '/tasks', label: 'Tasks', icon: ListTodo },
    { to: '/audit', label: 'Audit', icon: Shield },
    { to: '/events', label: 'Events', icon: Activity },
    { to: '/system', label: 'System', icon: Settings },
];

export type SidebarProps = {
    className?: string;
};

const SIDEBAR_NAME = 'Sidebar';

export const Sidebar = ({ className }: SidebarProps): ReactElement => {
    const [collapsed, setCollapsed] = useState(false);

    const routerState = useRouterState();
    const currentPath = routerState.location.pathname;

    const sidebarClasses = cn(
        'flex h-full flex-col border-border border-r bg-card',
        'transition-[width] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]',
        collapsed ? 'w-11' : 'w-48',
        className,
    );

    const toggleClasses = cn(
        'shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
    );

    return (
        <aside data-component={SIDEBAR_NAME} className={sidebarClasses}>
            {/* Header: logo + brand + collapse toggle */}
            <div className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-border border-b px-2.5">
                {!collapsed && (
                    <>
                        <div className="size-5 shrink-0 rounded bg-primary" />
                        <span className="flex-1 truncate font-bold text-foreground text-xs tracking-tight">
                            Data Kit
                        </span>
                    </>
                )}
                <button
                    type="button"
                    onClick={() => setCollapsed((prev) => !prev)}
                    className={toggleClasses}
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    title={collapsed ? 'Expand' : 'Collapse'}
                >
                    {collapsed ? (
                        <PanelRightClose className="size-4" />
                    ) : (
                        <PanelRightOpen className="size-4" />
                    )}
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex flex-1 flex-col gap-px overflow-y-auto overflow-x-hidden px-1.5 py-2">
                {NAV_ITEMS.map((item) => {
                    const isActive = currentPath.startsWith(item.to);
                    const Icon = item.icon;

                    const linkClasses = cn(
                        'flex items-center gap-2 rounded px-2.5 py-2 text-xs',
                        'overflow-hidden transition-colors',
                        isActive
                            ? 'bg-accent font-medium text-foreground'
                            : 'text-muted-foreground hover:bg-row-hover',
                    );

                    return (
                        <Link
                            key={item.to}
                            to={item.to}
                            className={linkClasses}
                            title={collapsed ? item.label : undefined}
                        >
                            <Icon
                                className={cn(
                                    'size-4 shrink-0',
                                    isActive
                                        ? 'text-primary'
                                        : 'text-text-dimmed',
                                )}
                            />
                            {!collapsed && (
                                <span className="truncate">{item.label}</span>
                            )}
                        </Link>
                    );
                })}
            </nav>
        </aside>
    );
};

Sidebar.displayName = SIDEBAR_NAME;
