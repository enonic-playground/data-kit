import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';

const TEXTAREA_NAME = 'Textarea';

export const Textarea = ({
    ref,
    className,
    ...props
}: ComponentProps<'textarea'>): ReactElement => {
    return (
        <textarea
            ref={ref}
            data-component={TEXTAREA_NAME}
            className={cn(
                'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                className,
            )}
            {...props}
        />
    );
};

Textarea.displayName = TEXTAREA_NAME;
