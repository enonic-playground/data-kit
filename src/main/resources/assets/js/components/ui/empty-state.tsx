import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type EmptyStateProps = {
    icon: LucideIcon;
    title: string;
    description: string;
    action?: ReactNode;
    className?: string;
};

const EMPTY_STATE_NAME = 'EmptyState';

export const EmptyState = ({
    icon: Icon,
    title,
    description,
    action,
    className,
}: EmptyStateProps): ReactElement => {
    return (
        <div
            data-component={EMPTY_STATE_NAME}
            className={cn(
                'flex flex-col items-center justify-center py-12 text-center',
                className,
            )}
        >
            <Icon className="mb-4 size-12 text-muted-foreground" />
            <h3 className="mb-1 font-semibold text-foreground text-lg">
                {title}
            </h3>
            <p className="mb-4 max-w-sm text-muted-foreground text-sm">
                {description}
            </p>
            {action != null && action}
        </div>
    );
};

EmptyState.displayName = EMPTY_STATE_NAME;
