import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';

//
// * TooltipProvider
//

export const TooltipProvider = TooltipPrimitive.Provider;

//
// * Tooltip
//

export const Tooltip = TooltipPrimitive.Root;

//
// * TooltipTrigger
//

export const TooltipTrigger = TooltipPrimitive.Trigger;

//
// * TooltipContent
//

const TOOLTIP_CONTENT_NAME = 'TooltipContent';

export const TooltipContent = ({
    ref,
    className,
    sideOffset = 4,
    ...props
}: ComponentProps<typeof TooltipPrimitive.Content>): ReactElement => {
    return (
        <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
                ref={ref}
                data-component={TOOLTIP_CONTENT_NAME}
                sideOffset={sideOffset}
                className={cn(
                    'fade-in-0 zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 animate-in overflow-hidden rounded-md border bg-card px-3 py-1.5 text-card-foreground text-sm shadow-md data-[state=closed]:animate-out',
                    className,
                )}
                {...props}
            />
        </TooltipPrimitive.Portal>
    );
};

TooltipContent.displayName = TOOLTIP_CONTENT_NAME;
