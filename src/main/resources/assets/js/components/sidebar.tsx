import { Link, useRouterState } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import {
    Camera,
    Database,
    FileOutput,
    HardDrive,
    ListTodo,
    PanelLeftClose,
    PanelLeftOpen,
    Radio,
    Search,
    Settings,
    ShieldCheck,
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
    { to: '/audit', label: 'Audit', icon: ShieldCheck },
    { to: '/events', label: 'Events', icon: Radio },
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
        'transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-56',
        className,
    );

    return (
        <aside data-component={SIDEBAR_NAME} className={sidebarClasses}>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
                {NAV_ITEMS.map((item) => {
                    const isActive = currentPath.startsWith(item.to);
                    const Icon = item.icon;

                    const linkClasses = cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 font-medium text-sm',
                        'transition-colors',
                        isActive
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    );

                    return (
                        <Link
                            key={item.to}
                            to={item.to}
                            className={linkClasses}
                            title={collapsed ? item.label : undefined}
                        >
                            <Icon className="size-4 shrink-0" />
                            {!collapsed && <span>{item.label}</span>}
                        </Link>
                    );
                })}
            </nav>
            <div className="border-border border-t p-2">
                <button
                    type="button"
                    onClick={() => setCollapsed((prev) => !prev)}
                    className={cn(
                        'flex w-full items-center gap-3 rounded-md px-3 py-2 font-medium text-sm',
                        'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                        'transition-colors',
                    )}
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {collapsed ? (
                        <PanelLeftOpen className="size-4 shrink-0" />
                    ) : (
                        <>
                            <PanelLeftClose className="size-4 shrink-0" />
                            <span>Collapse</span>
                        </>
                    )}
                </button>
            </div>
        </aside>
    );
};

Sidebar.displayName = SIDEBAR_NAME;
