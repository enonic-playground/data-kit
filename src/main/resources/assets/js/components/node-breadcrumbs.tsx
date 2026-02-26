import { ChevronRight } from 'lucide-react';
import type { ReactElement } from 'react';

export type NodeBreadcrumbsProps = {
    path: string;
    onNavigate: (path: string) => void;
};

const NODE_BREADCRUMBS_NAME = 'NodeBreadcrumbs';

export const NodeBreadcrumbs = ({
    path,
    onNavigate,
}: NodeBreadcrumbsProps): ReactElement => {
    const segments = path === '/'
        ? []
        : path.split('/').filter(Boolean);

    return (
        <span
            data-component={NODE_BREADCRUMBS_NAME}
            className="flex items-center gap-1.5"
        >
            <ChevronRight className="size-3.5" />
            <button
                type="button"
                className={
                    segments.length === 0
                        ? 'text-foreground'
                        : 'hover:text-foreground'
                }
                onClick={() => onNavigate('/')}
            >
                /
            </button>
            {segments.map((segment, index) => {
                const segmentPath = `/${segments.slice(0, index + 1).join('/')}`;
                const isLast = index === segments.length - 1;

                return (
                    <span key={segmentPath} className="flex items-center gap-1.5">
                        <ChevronRight className="size-3.5" />
                        <button
                            type="button"
                            className={
                                isLast
                                    ? 'text-foreground'
                                    : 'hover:text-foreground'
                            }
                            onClick={() => onNavigate(segmentPath)}
                        >
                            {segment}
                        </button>
                    </span>
                );
            })}
        </span>
    );
};

NodeBreadcrumbs.displayName = NODE_BREADCRUMBS_NAME;
