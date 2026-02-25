import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';

//
// * ScrollBar
//

const SCROLL_BAR_NAME = 'ScrollBar';

export const ScrollBar = ({
    ref,
    className,
    orientation = 'vertical',
    ...props
}: ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>): ReactElement => {
    return (
        <ScrollAreaPrimitive.ScrollAreaScrollbar
            ref={ref}
            orientation={orientation}
            className={cn(
                'flex touch-none select-none transition-colors',
                orientation === 'vertical' &&
                    'h-full w-2.5 border-l border-l-transparent p-[1px]',
                orientation === 'horizontal' &&
                    'h-2.5 flex-col border-t border-t-transparent p-[1px]',
                className,
            )}
            {...props}
        >
            <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
        </ScrollAreaPrimitive.ScrollAreaScrollbar>
    );
};

ScrollBar.displayName = SCROLL_BAR_NAME;

//
// * ScrollArea
//

const SCROLL_AREA_NAME = 'ScrollArea';

export const ScrollArea = ({
    ref,
    className,
    children,
    ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Root>): ReactElement => {
    return (
        <ScrollAreaPrimitive.Root
            ref={ref}
            data-component={SCROLL_AREA_NAME}
            className={cn('relative overflow-hidden', className)}
            {...props}
        >
            <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
                {children}
            </ScrollAreaPrimitive.Viewport>
            <ScrollBar />
            <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
    );
};

ScrollArea.displayName = SCROLL_AREA_NAME;
