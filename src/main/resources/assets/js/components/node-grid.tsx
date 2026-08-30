import { ArrowLeft, FileText, Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { NodeEntry } from '../lib/api/nodes';
import type { ReactElement } from 'react';

import { buildBinaryPreviewUrl } from '../lib/api/binary';
import { cn } from '../lib/utils';

const NODE_GRID_NAME = 'NodeGrid';

const CELL_FRAME = 'flex size-30 items-center justify-center rounded border bg-muted';

type NodeGridProps = {
  nodes: NodeEntry[];
  repoId: string;
  branch: string;
  selectedNodeId?: string;
  onSelect: (nodeId: string) => void;
  onNavigate: (path: string) => void;
  onNavigateUp: () => void;
};

//
// * NodeGridCell
//

const NodeGridCell = ({
  node,
  repoId,
  branch,
  isSelected,
  onSelect,
  onNavigate,
}: {
  node: NodeEntry;
  repoId: string;
  branch: string;
  isSelected: boolean;
  onSelect: (nodeId: string) => void;
  onNavigate: (path: string) => void;
}): ReactElement => {
  const image = node.image;
  const Icon = node.hasChildren ? Folder : FileText;

  const preview =
    image != null ? (
      <img
        src={buildBinaryPreviewUrl({
          repoId,
          branch,
          key: node._id,
          binaryReference: image.binaryReference,
          versionKey: node._versionKey,
        })}
        alt={node._name}
        loading="lazy"
        className="size-full rounded object-cover"
      />
    ) : (
      <Icon className="text-muted-foreground size-8" />
    );

  return (
    <button
      type="button"
      // A folder navigates rather than selects, so it carries no pressed state.
      aria-pressed={node.hasChildren ? undefined : isSelected}
      className="flex w-30 flex-col gap-1 text-left"
      onClick={() => {
        if (node.hasChildren) {
          onNavigate(node._path);
          return;
        }
        onSelect(node._id);
      }}
    >
      <span
        className={cn(
          CELL_FRAME,
          'overflow-hidden transition-colors',
          // ? A thumbnail covers the frame edge to edge, so the ring is what stays visible.
          isSelected
            ? 'border-border-accent bg-accent-muted ring-border-accent ring-2'
            : 'border-border',
        )}
      >
        {preview}
      </span>
      <span
        className={cn(
          'truncate font-mono text-[11px]',
          isSelected ? 'text-foreground font-medium' : 'text-muted-foreground',
        )}
        title={node._name}
      >
        {node._name}
      </span>
    </button>
  );
};

NodeGridCell.displayName = 'NodeGridCell';

//
// * NodeGrid
//

export const NodeGrid = ({
  nodes,
  repoId,
  branch,
  selectedNodeId,
  onSelect,
  onNavigate,
  onNavigateUp,
}: NodeGridProps): ReactElement => {
  const { t } = useTranslation();

  return (
    <div
      data-component={NODE_GRID_NAME}
      className="grid grid-cols-[repeat(auto-fill,7.5rem)] gap-2 p-4"
    >
      <button
        type="button"
        className="flex w-30 flex-col gap-1 text-left"
        aria-label={t('node.grid.parent')}
        onClick={onNavigateUp}
      >
        <span className={cn(CELL_FRAME, 'border-border')}>
          <ArrowLeft className="text-muted-foreground size-8" />
        </span>
        <span className="text-muted-foreground truncate font-mono text-[11px]">..</span>
      </button>
      {nodes.map((node) => (
        <NodeGridCell
          key={node._id}
          node={node}
          repoId={repoId}
          branch={branch}
          isSelected={selectedNodeId === node._id}
          onSelect={onSelect}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
};

NodeGrid.displayName = NODE_GRID_NAME;
