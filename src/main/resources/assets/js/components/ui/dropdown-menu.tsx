import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';

//
// * DropdownMenu
//

export const DropdownMenu = DropdownMenuPrimitive.Root;

//
// * DropdownMenuTrigger
//

export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

//
// * DropdownMenuGroup
//

export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

//
// * DropdownMenuPortal
//

export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

//
// * DropdownMenuSub
//

export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

//
// * DropdownMenuRadioGroup
//

export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

//
// * DropdownMenuSubTrigger
//

const DROPDOWN_MENU_SUB_TRIGGER_NAME = 'DropdownMenuSubTrigger';

export const DropdownMenuSubTrigger = ({
    ref,
    className,
    inset,
    children,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
}): ReactElement => {
    return (
        <DropdownMenuPrimitive.SubTrigger
            ref={ref}
            className={cn(
                'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent',
                inset && 'pl-8',
                className,
            )}
            {...props}
        >
            {children}
            <ChevronRight className="ml-auto size-4" />
        </DropdownMenuPrimitive.SubTrigger>
    );
};

DropdownMenuSubTrigger.displayName = DROPDOWN_MENU_SUB_TRIGGER_NAME;

//
// * DropdownMenuSubContent
//

const DROPDOWN_MENU_SUB_CONTENT_NAME = 'DropdownMenuSubContent';

export const DropdownMenuSubContent = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>): ReactElement => {
    return (
        <DropdownMenuPrimitive.SubContent
            ref={ref}
            className={cn(
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-md border bg-card p-1 text-card-foreground shadow-lg data-[state=closed]:animate-out data-[state=open]:animate-in',
                className,
            )}
            {...props}
        />
    );
};

DropdownMenuSubContent.displayName = DROPDOWN_MENU_SUB_CONTENT_NAME;

//
// * DropdownMenuContent
//

const DROPDOWN_MENU_CONTENT_NAME = 'DropdownMenuContent';

export const DropdownMenuContent = ({
    ref,
    className,
    sideOffset = 4,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>): ReactElement => {
    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
                ref={ref}
                data-component={DROPDOWN_MENU_CONTENT_NAME}
                sideOffset={sideOffset}
                className={cn(
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-md border bg-card p-1 text-card-foreground shadow-md data-[state=closed]:animate-out data-[state=open]:animate-in',
                    className,
                )}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    );
};

DropdownMenuContent.displayName = DROPDOWN_MENU_CONTENT_NAME;

//
// * DropdownMenuItem
//

const DROPDOWN_MENU_ITEM_NAME = 'DropdownMenuItem';

export const DropdownMenuItem = ({
    ref,
    className,
    inset,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
}): ReactElement => {
    return (
        <DropdownMenuPrimitive.Item
            ref={ref}
            className={cn(
                'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                inset && 'pl-8',
                className,
            )}
            {...props}
        />
    );
};

DropdownMenuItem.displayName = DROPDOWN_MENU_ITEM_NAME;

//
// * DropdownMenuCheckboxItem
//

const DROPDOWN_MENU_CHECKBOX_ITEM_NAME = 'DropdownMenuCheckboxItem';

export const DropdownMenuCheckboxItem = ({
    ref,
    className,
    children,
    checked,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>): ReactElement => {
    return (
        <DropdownMenuPrimitive.CheckboxItem
            ref={ref}
            className={cn(
                'relative flex cursor-default select-none items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                className,
            )}
            checked={checked}
            {...props}
        >
            <span className="absolute left-2 flex size-3.5 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <Check className="size-4" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
            {children}
        </DropdownMenuPrimitive.CheckboxItem>
    );
};

DropdownMenuCheckboxItem.displayName = DROPDOWN_MENU_CHECKBOX_ITEM_NAME;

//
// * DropdownMenuRadioItem
//

const DROPDOWN_MENU_RADIO_ITEM_NAME = 'DropdownMenuRadioItem';

export const DropdownMenuRadioItem = ({
    ref,
    className,
    children,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>): ReactElement => {
    return (
        <DropdownMenuPrimitive.RadioItem
            ref={ref}
            className={cn(
                'relative flex cursor-default select-none items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                className,
            )}
            {...props}
        >
            <span className="absolute left-2 flex size-3.5 items-center justify-center">
                <DropdownMenuPrimitive.ItemIndicator>
                    <Circle className="size-2 fill-current" />
                </DropdownMenuPrimitive.ItemIndicator>
            </span>
            {children}
        </DropdownMenuPrimitive.RadioItem>
    );
};

DropdownMenuRadioItem.displayName = DROPDOWN_MENU_RADIO_ITEM_NAME;

//
// * DropdownMenuLabel
//

const DROPDOWN_MENU_LABEL_NAME = 'DropdownMenuLabel';

export const DropdownMenuLabel = ({
    ref,
    className,
    inset,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
}): ReactElement => {
    return (
        <DropdownMenuPrimitive.Label
            ref={ref}
            className={cn(
                'px-2 py-1.5 font-semibold text-sm',
                inset && 'pl-8',
                className,
            )}
            {...props}
        />
    );
};

DropdownMenuLabel.displayName = DROPDOWN_MENU_LABEL_NAME;

//
// * DropdownMenuSeparator
//

const DROPDOWN_MENU_SEPARATOR_NAME = 'DropdownMenuSeparator';

export const DropdownMenuSeparator = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>): ReactElement => {
    return (
        <DropdownMenuPrimitive.Separator
            ref={ref}
            className={cn('-mx-1 my-1 h-px bg-muted', className)}
            {...props}
        />
    );
};

DropdownMenuSeparator.displayName = DROPDOWN_MENU_SEPARATOR_NAME;
