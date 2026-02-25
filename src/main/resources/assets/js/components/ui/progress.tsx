import * as ProgressPrimitive from '@radix-ui/react-progress';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';

const PROGRESS_NAME = 'Progress';

export const Progress = ({
    ref,
    className,
    value,
    ...props
}: ComponentProps<typeof ProgressPrimitive.Root>): ReactElement => {
    return (
        <ProgressPrimitive.Root
            ref={ref}
            data-component={PROGRESS_NAME}
            className={cn(
                'relative h-4 w-full overflow-hidden rounded-full bg-secondary',
                className,
            )}
            {...props}
        >
            <ProgressPrimitive.Indicator
                className="h-full w-full flex-1 bg-primary transition-all"
                style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
            />
        </ProgressPrimitive.Root>
    );
};

Progress.displayName = PROGRESS_NAME;
