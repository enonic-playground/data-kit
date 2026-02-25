import type { ReactElement } from 'react';
import { Toaster as Sonner, toast } from 'sonner';
import { useTheme } from '../theme-provider';

const TOASTER_NAME = 'Toaster';

export const Toaster = (): ReactElement => {
    const { theme } = useTheme();

    return (
        <Sonner
            data-component={TOASTER_NAME}
            theme={theme === 'system' ? undefined : theme}
            className="toaster group"
            toastOptions={{
                classNames: {
                    toast: 'group toast group-[.toaster]:border-border group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:shadow-lg',
                    description: 'group-[.toast]:text-muted-foreground',
                    actionButton:
                        'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
                    cancelButton:
                        'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
                },
            }}
        />
    );
};

Toaster.displayName = TOASTER_NAME;

export { toast };
