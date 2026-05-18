import type { ReactElement, ReactNode } from 'react';

import { cn } from '../../lib/utils';

export type CodeProps = {
  className?: string;
  children?: ReactNode;
};

const CODE_NAME = 'Code';

export const Code = ({ className, children }: CodeProps): ReactElement => {
  return (
    <code
      data-component={CODE_NAME}
      className={cn(
        'bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[0.85em]',
        className,
      )}
    >
      {children}
    </code>
  );
};

Code.displayName = CODE_NAME;
