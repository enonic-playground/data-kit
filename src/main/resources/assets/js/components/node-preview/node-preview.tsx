import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { type ReactElement, type SyntheticEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  BINARY_TEXT_LIMIT,
  buildBinaryDownloadUrl,
  buildBinaryPreviewUrl,
  fetchBinaryText,
} from '../../lib/api/binary';
import type { NodeBinaryDetail } from '../../lib/api/nodes';
import { formatFileSize } from '../../lib/format';
import { Skeleton } from '../ui/skeleton';
import { type BinaryDimensions, BinaryDetailStrip } from './binary-detail-strip';

//
// * Helpers
//

const TEXT_MIME_TYPES = [
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
];

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function isPdfMime(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

function isTextMime(mimeType: string): boolean {
  return mimeType.startsWith('text/') || TEXT_MIME_TYPES.includes(mimeType);
}

//
// * BinaryTextPreview
//

const BINARY_TEXT_PREVIEW_NAME = 'BinaryTextPreview';

type BinarySource = {
  repoId: string;
  branch: string;
  key: string;
  binaryReference: string;
  versionKey: string;
};

const BinaryTextPreview = ({ source }: { source: BinarySource }): ReactElement => {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    // ? Keyed on the version, and a version's binaries never change — so a hit is never stale.
    queryKey: [
      'binary-text',
      source.repoId,
      source.branch,
      source.key,
      source.versionKey,
      source.binaryReference,
    ],
    queryFn: ({ signal }) => fetchBinaryText(source, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (isLoading) {
    return (
      <div data-component={BINARY_TEXT_PREVIEW_NAME} className="space-y-2 p-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }

  if (error != null || data == null) {
    return (
      <div
        data-component={BINARY_TEXT_PREVIEW_NAME}
        className="text-destructive p-4 text-center text-sm"
      >
        {t('node.preview.textFailed')}
      </div>
    );
  }

  return (
    <div data-component={BINARY_TEXT_PREVIEW_NAME} className="flex min-h-0 flex-1 flex-col">
      <pre className="bg-muted min-h-0 flex-1 overflow-auto rounded-md p-4 font-mono text-xs">
        {data.text}
      </pre>
      {data.truncated && (
        <p className="text-muted-foreground shrink-0 pt-2 text-xs">
          {t('node.preview.truncated', { size: formatFileSize(BINARY_TEXT_LIMIT) })}
        </p>
      )}
    </div>
  );
};

BinaryTextPreview.displayName = BINARY_TEXT_PREVIEW_NAME;

//
// * BinaryFileCard
//

const BINARY_FILE_CARD_NAME = 'BinaryFileCard';

const BinaryFileCard = ({ binaryReference }: { binaryReference: string }): ReactElement => {
  const { t } = useTranslation();

  return (
    <div
      data-component={BINARY_FILE_CARD_NAME}
      className="bg-muted flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-md p-8"
    >
      <FileText className="text-muted-foreground size-10" />
      <p className="text-sm font-medium">{binaryReference}</p>
      <p className="text-muted-foreground text-xs">{t('node.preview.noInlineView')}</p>
    </div>
  );
};

BinaryFileCard.displayName = BINARY_FILE_CARD_NAME;

//
// * NodePreview
//

const NODE_PREVIEW_NAME = 'NodePreview';

export type NodePreviewProps = {
  repoId: string;
  branch: string;
  nodeId: string;
  nodeName: string;
  versionKey: string;
  binary: NodeBinaryDetail;
};

export const NodePreview = ({
  repoId,
  branch,
  nodeId,
  nodeName,
  versionKey,
  binary,
}: NodePreviewProps): ReactElement => {
  const [dimensions, setDimensions] = useState<BinaryDimensions | undefined>(undefined);

  const source: BinarySource = {
    repoId,
    branch,
    key: nodeId,
    binaryReference: binary.binaryReference,
    versionKey,
  };
  const previewUrl = buildBinaryPreviewUrl(source);
  const downloadUrl = buildBinaryDownloadUrl(source);

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) {
      setDimensions({ width: naturalWidth, height: naturalHeight });
    }
  };

  const view = (): ReactElement => {
    if (isImageMime(binary.mimeType)) {
      return (
        <div className="bg-muted flex min-h-0 flex-1 items-center justify-center rounded-md p-4">
          <img
            src={previewUrl}
            alt={nodeName}
            onLoad={handleImageLoad}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      );
    }

    if (isPdfMime(binary.mimeType)) {
      return (
        <object data={previewUrl} type="application/pdf" className="min-h-0 flex-1 rounded-md">
          <BinaryFileCard binaryReference={binary.binaryReference} />
        </object>
      );
    }

    if (isTextMime(binary.mimeType)) {
      return <BinaryTextPreview source={source} />;
    }

    return <BinaryFileCard binaryReference={binary.binaryReference} />;
  };

  return (
    <div
      data-component={NODE_PREVIEW_NAME}
      className="flex h-full min-h-0 flex-col gap-2 p-4 pt-0"
    >
      <BinaryDetailStrip
        binaryReference={binary.binaryReference}
        mimeType={binary.mimeType}
        size={binary.size}
        downloadUrl={downloadUrl}
        dimensions={dimensions}
      />
      {view()}
    </div>
  );
};

NodePreview.displayName = NODE_PREVIEW_NAME;
