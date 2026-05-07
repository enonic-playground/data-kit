import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
    getProgress,
    isTerminalState,
    taskQueryOptions,
} from '../../lib/api/tasks';
import { useTaskProgress } from '../../lib/hooks/use-task-progress';
import { useWebSocket } from '../../lib/hooks/use-websocket';
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
    taskId?: string;
    description?: string;
    progress?: number;
    open: boolean;
    onOpenChange?: (open: boolean) => void;
};

const PROGRESS_DIALOG_NAME = 'ProgressDialog';
const FALLBACK_POLL_MS = 1500;

export const ProgressDialog = ({
    title,
    taskId,
    description,
    progress,
    open,
    onOpenChange,
}: ProgressDialogProps): ReactElement => {
    const { t } = useTranslation();
    const { status } = useWebSocket();
    useTaskProgress(taskId);

    const { data: task } = useQuery({
        ...taskQueryOptions(taskId),
        refetchInterval: (query) => {
            if (isTerminalState(query.state.data?.state)) return false;
            return status === 'open' ? false : FALLBACK_POLL_MS;
        },
    });

    const resolvedProgress = taskId != null ? getProgress(task) : (progress ?? 0);
    const resolvedDescription = taskId != null
        ? (task?.progress.info || t('common.progress.starting'))
        : description;

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
                    {resolvedDescription != null && (
                        <DialogDescription>{resolvedDescription}</DialogDescription>
                    )}
                </DialogHeader>
                <Progress value={resolvedProgress} className="w-full" />
                <p className="text-center text-muted-foreground text-sm">
                    {Math.round(resolvedProgress)}%
                </p>
            </DialogContent>
        </Dialog>
    );
};

ProgressDialog.displayName = PROGRESS_DIALOG_NAME;
