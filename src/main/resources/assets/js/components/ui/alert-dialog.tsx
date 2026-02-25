import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import type { ComponentProps, ReactElement } from 'react';
import { cn } from '../../lib/utils';
import { buttonVariants } from './button';

//
// * AlertDialog
//

export const AlertDialog = AlertDialogPrimitive.Root;

//
// * AlertDialogTrigger
//

export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

//
// * AlertDialogPortal
//

export const AlertDialogPortal = AlertDialogPrimitive.Portal;

//
// * AlertDialogOverlay
//

const ALERT_DIALOG_OVERLAY_NAME = 'AlertDialogOverlay';

export const AlertDialogOverlay = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Overlay>): ReactElement => {
    return (
        <AlertDialogPrimitive.Overlay
            ref={ref}
            className={cn(
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/80 data-[state=closed]:animate-out data-[state=open]:animate-in',
                className,
            )}
            {...props}
        />
    );
};

AlertDialogOverlay.displayName = ALERT_DIALOG_OVERLAY_NAME;

//
// * AlertDialogContent
//

const ALERT_DIALOG_CONTENT_NAME = 'AlertDialogContent';

export const AlertDialogContent = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>): ReactElement => {
    return (
        <AlertDialogPortal>
            <AlertDialogOverlay />
            <AlertDialogPrimitive.Content
                ref={ref}
                data-component={ALERT_DIALOG_CONTENT_NAME}
                className={cn(
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] fixed top-[50%] left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in sm:rounded-lg',
                    className,
                )}
                {...props}
            />
        </AlertDialogPortal>
    );
};

AlertDialogContent.displayName = ALERT_DIALOG_CONTENT_NAME;

//
// * AlertDialogHeader
//

const ALERT_DIALOG_HEADER_NAME = 'AlertDialogHeader';

export const AlertDialogHeader = ({
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

AlertDialogHeader.displayName = ALERT_DIALOG_HEADER_NAME;

//
// * AlertDialogFooter
//

const ALERT_DIALOG_FOOTER_NAME = 'AlertDialogFooter';

export const AlertDialogFooter = ({
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

AlertDialogFooter.displayName = ALERT_DIALOG_FOOTER_NAME;

//
// * AlertDialogTitle
//

const ALERT_DIALOG_TITLE_NAME = 'AlertDialogTitle';

export const AlertDialogTitle = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>): ReactElement => {
    return (
        <AlertDialogPrimitive.Title
            ref={ref}
            className={cn('font-semibold text-lg', className)}
            {...props}
        />
    );
};

AlertDialogTitle.displayName = ALERT_DIALOG_TITLE_NAME;

//
// * AlertDialogDescription
//

const ALERT_DIALOG_DESCRIPTION_NAME = 'AlertDialogDescription';

export const AlertDialogDescription = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>): ReactElement => {
    return (
        <AlertDialogPrimitive.Description
            ref={ref}
            className={cn('text-muted-foreground text-sm', className)}
            {...props}
        />
    );
};

AlertDialogDescription.displayName = ALERT_DIALOG_DESCRIPTION_NAME;

//
// * AlertDialogAction
//

const ALERT_DIALOG_ACTION_NAME = 'AlertDialogAction';

export const AlertDialogAction = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Action>): ReactElement => {
    return (
        <AlertDialogPrimitive.Action
            ref={ref}
            className={cn(buttonVariants(), className)}
            {...props}
        />
    );
};

AlertDialogAction.displayName = ALERT_DIALOG_ACTION_NAME;

//
// * AlertDialogCancel
//

const ALERT_DIALOG_CANCEL_NAME = 'AlertDialogCancel';

export const AlertDialogCancel = ({
    ref,
    className,
    ...props
}: ComponentProps<typeof AlertDialogPrimitive.Cancel>): ReactElement => {
    return (
        <AlertDialogPrimitive.Cancel
            ref={ref}
            className={cn(
                buttonVariants({ variant: 'outline' }),
                'mt-2 sm:mt-0',
                className,
            )}
            {...props}
        />
    );
};

AlertDialogCancel.displayName = ALERT_DIALOG_CANCEL_NAME;
