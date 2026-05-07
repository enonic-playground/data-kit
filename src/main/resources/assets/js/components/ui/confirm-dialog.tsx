import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from './alert-dialog';
import { buttonVariants } from './button';

export type ConfirmDialogProps = {
    title: string;
    description: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'primary' | 'destructive';
    onConfirm: () => void;
    onCancel?: () => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
};

const CONFIRM_DIALOG_NAME = 'ConfirmDialog';

export const ConfirmDialog = ({
    title,
    description,
    confirmLabel,
    cancelLabel,
    variant = 'primary',
    onConfirm,
    onCancel,
    open,
    onOpenChange,
    children,
}: ConfirmDialogProps): ReactElement => {
    const { t } = useTranslation();
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            {children != null && (
                <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
            )}
            <AlertDialogContent data-component={CONFIRM_DIALOG_NAME}>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {description}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={onCancel}>
                        {cancelLabel ?? t('common.action.cancel')}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={onConfirm}
                        className={buttonVariants({ variant })}
                    >
                        {confirmLabel ?? t('common.action.confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

ConfirmDialog.displayName = CONFIRM_DIALOG_NAME;
