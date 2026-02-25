import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';

const LABEL_NAME = 'Label';

export const Label = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof LabelPrimitive.Root>): ReactElement => {
    return (
        <LabelPrimitive.Root
            ref={ref}
            data-component={LABEL_NAME}
            className={cn(
                'font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
                className,
            )}
            {...props}
        />
    );
};

Label.displayName = LABEL_NAME;
