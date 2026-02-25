import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';

//
// * Dialog
//

export const Dialog = DialogPrimitive.Root;

//
// * DialogTrigger
//

export const DialogTrigger = DialogPrimitive.Trigger;

//
// * DialogClose
//

export const DialogClose = DialogPrimitive.Close;

//
// * DialogPortal
//

export const DialogPortal = DialogPrimitive.Portal;

//
// * DialogOverlay
//

const DIALOG_OVERLAY_NAME = 'DialogOverlay';

export const DialogOverlay = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>): ReactElement => {
    return (
        <DialogPrimitive.Overlay
            ref={ref}
            className={cn(
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=open]:animate-in',
                className,
            )}
            {...props}
        />
    );
};

DialogOverlay.displayName = DIALOG_OVERLAY_NAME;

//
// * DialogContent
//

const DIALOG_CONTENT_NAME = 'DialogContent';

export const DialogContent = ({
    ref,
    className,
    children,
    ...props
}: ComponentProps<typeof DialogPrimitive.Content>): ReactElement => {
    return (
        <DialogPortal>
            <DialogOverlay />
            <DialogPrimitive.Content
                ref={ref}
                data-component={DIALOG_CONTENT_NAME}
                className={cn(
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in sm:rounded-lg',
                    className,
                )}
                {...props}
            >
                {children}
                <DialogPrimitive.Close className="absolute top-4 right-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                    <X className="size-4" />
                    <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
            </DialogPrimitive.Content>
        </DialogPortal>
    );
};

DialogContent.displayName = DIALOG_CONTENT_NAME;

//
// * DialogHeader
//

const DIALOG_HEADER_NAME = 'DialogHeader';

export const DialogHeader = ({
    className,
    ...props
}: ComponentProps<'div'>): ReactElement => {
    return (
        <div
            className={cn(
                'flex flex-col space-y-1.5 text-center sm:text-left',
                className,
            )}
            {...props}
        />
    );
};

DialogHeader.displayName = DIALOG_HEADER_NAME;

//
// * DialogFooter
//

const DIALOG_FOOTER_NAME = 'DialogFooter';

export const DialogFooter = ({
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

DialogFooter.displayName = DIALOG_FOOTER_NAME;

//
// * DialogTitle
//

const DIALOG_TITLE_NAME = 'DialogTitle';

export const DialogTitle = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof DialogPrimitive.Title>): ReactElement => {
    return (
        <DialogPrimitive.Title
            ref={ref}
            className={cn(
                'font-semibold text-lg leading-none tracking-tight',
                className,
            )}
            {...props}
        />
    );
};

DialogTitle.displayName = DIALOG_TITLE_NAME;

//
// * DialogDescription
//

const DIALOG_DESCRIPTION_NAME = 'DialogDescription';

export const DialogDescription = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof DialogPrimitive.Description>): ReactElement => {
    return (
        <DialogPrimitive.Description
            ref={ref}
            className={cn('text-muted-foreground text-sm', className)}
            {...props}
        />
    );
};

DialogDescription.displayName = DIALOG_DESCRIPTION_NAME;
