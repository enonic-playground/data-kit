import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';

const INPUT_NAME = 'Input';

export const Input = ({
    ref,
    className,
    type,
    ...props
}: ComponentProps<'input'>): ReactElement => {
    return (
        <input
            ref={ref}
            type={type}
            data-component={INPUT_NAME}
            className={cn(
                'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                className,
            )}
            {...props}
        />
    );
};

Input.displayName = INPUT_NAME;
