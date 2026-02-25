import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';

//
// * Sheet
//

export const Sheet = SheetPrimitive.Root;

//
// * SheetTrigger
//

export const SheetTrigger = SheetPrimitive.Trigger;

//
// * SheetClose
//

export const SheetClose = SheetPrimitive.Close;

//
// * SheetPortal
//

export const SheetPortal = SheetPrimitive.Portal;

//
// * SheetOverlay
//

const SHEET_OVERLAY_NAME = 'SheetOverlay';

export const SheetOverlay = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof SheetPrimitive.Overlay>): ReactElement => {
    return (
        <SheetPrimitive.Overlay
            ref={ref}
            className={cn(
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=open]:animate-in',
                className,
            )}
            {...props}
        />
    );
};

SheetOverlay.displayName = SHEET_OVERLAY_NAME;

//
// * SheetContent
//

const sheetVariants = cva(
    'fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:duration-300 data-[state=open]:duration-500',
    {
        variants: {
            side: {
                top: 'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 border-b',
                bottom: 'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 border-t',
                left: 'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
                right: 'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
            },
        },
        defaultVariants: {
            side: 'right',
        },
    },
);

const SHEET_CONTENT_NAME = 'SheetContent';

export const SheetContent = ({
    ref,
    side = 'right',
    className,
    children,
    ...props
}: ComponentProps<typeof SheetPrimitive.Content> &
    VariantProps<typeof sheetVariants>): ReactElement => {
    return (
        <SheetPortal>
            <SheetOverlay />
            <SheetPrimitive.Content
                ref={ref}
                data-component={SHEET_CONTENT_NAME}
                className={cn(sheetVariants({ side }), className)}
                {...props}
            >
                {children}
                <SheetPrimitive.Close className="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
                    <X className="size-4" />
                    <span className="sr-only">Close</span>
                </SheetPrimitive.Close>
            </SheetPrimitive.Content>
        </SheetPortal>
    );
};

SheetContent.displayName = SHEET_CONTENT_NAME;

//
// * SheetHeader
//

const SHEET_HEADER_NAME = 'SheetHeader';

export const SheetHeader = ({
    className,
    ...props
}: ComponentProps<'div'>): ReactElement => {
    return (
        <div
            className={cn(
                'flex flex-col space-y-2 text-center sm:text-left',
                className,
            )}
            {...props}
        />
    );
};

SheetHeader.displayName = SHEET_HEADER_NAME;

//
// * SheetFooter
//

const SHEET_FOOTER_NAME = 'SheetFooter';

export const SheetFooter = ({
    className,
    ...props
}: ComponentProps<'div'>): ReactElement => {
    return (
        <div
            className={cn(
                'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
                className,
            )}
            {...props}
        />
    );
};

SheetFooter.displayName = SHEET_FOOTER_NAME;

//
// * SheetTitle
//

const SHEET_TITLE_NAME = 'SheetTitle';

export const SheetTitle = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof SheetPrimitive.Title>): ReactElement => {
    return (
        <SheetPrimitive.Title
            ref={ref}
            className={cn('font-semibold text-foreground text-lg', className)}
            {...props}
        />
    );
};

SheetTitle.displayName = SHEET_TITLE_NAME;

//
// * SheetDescription
//

const SHEET_DESCRIPTION_NAME = 'SheetDescription';

export const SheetDescription = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof SheetPrimitive.Description>): ReactElement => {
    return (
        <SheetPrimitive.Description
            ref={ref}
            className={cn('text-muted-foreground text-sm', className)}
            {...props}
        />
    );
};

SheetDescription.displayName = SHEET_DESCRIPTION_NAME;
