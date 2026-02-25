import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';

//
// * Select
//

export const Select = SelectPrimitive.Root;

//
// * SelectGroup
//

export const SelectGroup = SelectPrimitive.Group;

//
// * SelectValue
//

export const SelectValue = SelectPrimitive.Value;

//
// * SelectTrigger
//

const SELECT_TRIGGER_NAME = 'SelectTrigger';

export const SelectTrigger = ({
    ref,
    className,
    children,
    ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>): ReactElement => {
    return (
        <SelectPrimitive.Trigger
            ref={ref}
            data-component={SELECT_TRIGGER_NAME}
            className={cn(
                'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
                className,
            )}
            {...props}
        >
            {children}
            <SelectPrimitive.Icon asChild>
                <ChevronDown className="size-4 opacity-50" />
            </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
    );
};

SelectTrigger.displayName = SELECT_TRIGGER_NAME;

//
// * SelectScrollUpButton
//

const SELECT_SCROLL_UP_NAME = 'SelectScrollUpButton';

const SelectScrollUpButton = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof SelectPrimitive.ScrollUpButton>): ReactElement => {
    return (
        <SelectPrimitive.ScrollUpButton
            ref={ref}
            className={cn(
                'flex cursor-default items-center justify-center py-1',
                className,
            )}
            {...props}
        >
            <ChevronUp className="size-4" />
        </SelectPrimitive.ScrollUpButton>
    );
};

SelectScrollUpButton.displayName = SELECT_SCROLL_UP_NAME;

//
// * SelectScrollDownButton
//

const SELECT_SCROLL_DOWN_NAME = 'SelectScrollDownButton';

const SelectScrollDownButton = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof SelectPrimitive.ScrollDownButton>): ReactElement => {
    return (
        <SelectPrimitive.ScrollDownButton
            ref={ref}
            className={cn(
                'flex cursor-default items-center justify-center py-1',
                className,
            )}
            {...props}
        >
            <ChevronDown className="size-4" />
        </SelectPrimitive.ScrollDownButton>
    );
};

SelectScrollDownButton.displayName = SELECT_SCROLL_DOWN_NAME;

//
// * SelectContent
//

const SELECT_CONTENT_NAME = 'SelectContent';

export const SelectContent = ({
    ref,
    className,
    children,
    position = 'popper',
    ...props
}: ComponentProps<typeof SelectPrimitive.Content>): ReactElement => {
    return (
        <SelectPrimitive.Portal>
            <SelectPrimitive.Content
                ref={ref}
                className={cn(
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-card text-card-foreground shadow-md data-[state=closed]:animate-out data-[state=open]:animate-in',
                    position === 'popper' &&
                        'data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
                    className,
                )}
                position={position}
                {...props}
            >
                <SelectScrollUpButton />
                <SelectPrimitive.Viewport
                    className={cn(
                        'p-1',
                        position === 'popper' &&
                            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
                    )}
                >
                    {children}
                </SelectPrimitive.Viewport>
                <SelectScrollDownButton />
            </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
    );
};

SelectContent.displayName = SELECT_CONTENT_NAME;

//
// * SelectLabel
//

const SELECT_LABEL_NAME = 'SelectLabel';

export const SelectLabel = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof SelectPrimitive.Label>): ReactElement => {
    return (
        <SelectPrimitive.Label
            ref={ref}
            className={cn('py-1.5 pr-2 pl-8 font-semibold text-sm', className)}
            {...props}
        />
    );
};

SelectLabel.displayName = SELECT_LABEL_NAME;

//
// * SelectItem
//

const SELECT_ITEM_NAME = 'SelectItem';

export const SelectItem = ({
    ref,
    className,
    children,
    ...props
}: ComponentProps<typeof SelectPrimitive.Item>): ReactElement => {
    return (
        <SelectPrimitive.Item
            ref={ref}
            className={cn(
                'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                className,
            )}
            {...props}
        >
            <span className="absolute left-2 flex size-3.5 items-center justify-center">
                <SelectPrimitive.ItemIndicator>
                    <Check className="size-4" />
                </SelectPrimitive.ItemIndicator>
            </span>
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        </SelectPrimitive.Item>
    );
};

SelectItem.displayName = SELECT_ITEM_NAME;

//
// * SelectSeparator
//

const SELECT_SEPARATOR_NAME = 'SelectSeparator';

export const SelectSeparator = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof SelectPrimitive.Separator>): ReactElement => {
    return (
        <SelectPrimitive.Separator
            ref={ref}
            className={cn('-mx-1 my-1 h-px bg-muted', className)}
            {...props}
        />
    );
};

SelectSeparator.displayName = SELECT_SEPARATOR_NAME;
