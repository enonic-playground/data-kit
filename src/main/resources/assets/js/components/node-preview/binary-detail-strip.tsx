import { Download } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { formatFileSize } from '../../lib/format';
import { cn } from '../../lib/utils';

//
// * BinaryDetailStrip
//

const BINARY_DETAIL_STRIP_NAME = 'BinaryDetailStrip';

export type BinaryDimensions = {
  width: number;
  height: number;
};

export type BinaryDetailStripProps = {
  binaryReference: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
  dimensions?: BinaryDimensions;
  className?: string;
};

export const BinaryDetailStrip = ({
  binaryReference,
  mimeType,
  size,
  downloadUrl,
  dimensions,
  className,
}: BinaryDetailStripProps): ReactElement => {
  const { t } = useTranslation();

  return (
    <div
      data-component={BINARY_DETAIL_STRIP_NAME}
      className={cn(
        'border-border bg-muted/40 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1',
        'rounded-md border px-3 py-2 text-xs',
        className,
      )}
    >
      <span className="text-foreground min-w-0 truncate font-medium" title={binaryReference}>
        {binaryReference}
      </span>
      <span className="text-muted-foreground">{mimeType}</span>
      <span className="text-muted-foreground">{formatFileSize(size)}</span>
      {dimensions != null && (
        <span className="text-muted-foreground">
          {t('node.preview.dimensions', {
            width: dimensions.width,
            height: dimensions.height,
          })}
        </span>
      )}
      <a
        href={downloadUrl}
        download={binaryReference}
        className={cn(
          'text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1',
          'transition-colors',
        )}
        title={t('node.preview.download')}
      >
        <Download className="size-3.5" />
        <span>{t('node.preview.download')}</span>
      </a>
    </div>
  );
};

BinaryDetailStrip.displayName = BINARY_DETAIL_STRIP_NAME;
