import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';

//
// * Tabs
//

export const Tabs = TabsPrimitive.Root;

//
// * TabsList
//

const TABS_LIST_NAME = 'TabsList';

export const TabsList = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof TabsPrimitive.List>): ReactElement => {
    return (
        <TabsPrimitive.List
            ref={ref}
            data-component={TABS_LIST_NAME}
            className={cn(
                'inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
                className,
            )}
            {...props}
        />
    );
};

TabsList.displayName = TABS_LIST_NAME;

//
// * TabsTrigger
//

const TABS_TRIGGER_NAME = 'TabsTrigger';

export const TabsTrigger = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>): ReactElement => {
    return (
        <TabsPrimitive.Trigger
            ref={ref}
            className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 font-medium text-sm ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
                className,
            )}
            {...props}
        />
    );
};

TabsTrigger.displayName = TABS_TRIGGER_NAME;

//
// * TabsContent
//

const TABS_CONTENT_NAME = 'TabsContent';

export const TabsContent = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof TabsPrimitive.Content>): ReactElement => {
    return (
        <TabsPrimitive.Content
            ref={ref}
            className={cn(
                'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                className,
            )}
            {...props}
        />
    );
};

TabsContent.displayName = TABS_CONTENT_NAME;
