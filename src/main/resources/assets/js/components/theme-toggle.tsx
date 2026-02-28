import { Moon, Sun, SunMoon } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '../lib/utils';
import { useTheme } from './theme-provider';

export type ThemeToggleProps = {
    className?: string;
};

const THEME_TOGGLE_NAME = 'ThemeToggle';

const THEME_CYCLE = ['light', 'dark', 'system'] as const;

export const ThemeToggle = ({ className }: ThemeToggleProps): ReactElement => {
    const { theme, setTheme } = useTheme();

    const handleClick = (): void => {
        const currentIndex = THEME_CYCLE.indexOf(theme);
        const nextIndex = (currentIndex + 1) % THEME_CYCLE.length;
        setTheme(THEME_CYCLE[nextIndex]);
    };

    const icon =
        theme === 'light' ? (
            <Sun className="size-4" />
        ) : theme === 'dark' ? (
            <Moon className="size-4" />
        ) : (
            <SunMoon className="size-4.5" />
        );

    const label =
        theme === 'light'
            ? 'Light'
            : theme === 'dark'
              ? 'Dark'
              : 'System';

    const classNames = cn(
        'inline-flex size-8 items-center justify-center rounded-md',
        'text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
    );

    return (
        <button
            data-component={THEME_TOGGLE_NAME}
            type="button"
            onClick={handleClick}
            className={classNames}
            aria-label={`Theme: ${label}`}
            title={`Theme: ${label}`}
        >
            {icon}
        </button>
    );
};

ThemeToggle.displayName = THEME_TOGGLE_NAME;
