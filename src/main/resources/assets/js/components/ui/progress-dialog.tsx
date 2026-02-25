import type { ReactElement } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from './dialog';
import { Progress } from './progress';

export type ProgressDialogProps = {
    title: string;
    description?: string;
    progress: number;
    open: boolean;
    onOpenChange?: (open: boolean) => void;
};

const PROGRESS_DIALOG_NAME = 'ProgressDialog';

export const ProgressDialog = ({
    title,
    description,
    progress,
    open,
    onOpenChange,
}: ProgressDialogProps): ReactElement => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                data-component={PROGRESS_DIALOG_NAME}
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
                className="[&>button:last-child]:hidden"
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description != null && (
                        <DialogDescription>{description}</DialogDescription>
                    )}
                </DialogHeader>
                <Progress value={progress} className="w-full" />
                <p className="text-center text-muted-foreground text-sm">
                    {Math.round(progress)}%
                </p>
            </DialogContent>
        </Dialog>
    );
};

ProgressDialog.displayName = PROGRESS_DIALOG_NAME;
