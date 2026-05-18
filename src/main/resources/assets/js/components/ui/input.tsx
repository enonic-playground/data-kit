import type { ComponentProps, ReactElement } from 'react';

import { cn } from '../../lib/utils';

const INPUT_NAME = 'Input';

export const Input = ({
  ref,
  className,
  type,
  ...props
}: ComponentProps<'input'>): ReactElement => {
  return (
    <input
      ref={ref}
      type={type}
      data-component={INPUT_NAME}
      className={cn(
        'border-input bg-background ring-offset-background file:text-foreground placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
};

Input.displayName = INPUT_NAME;
