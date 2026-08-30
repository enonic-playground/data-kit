import { ArrowLeft, FileText, Folder } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { NodeEntry } from '../lib/api/nodes';
import type { ReactElement } from 'react';

import { cn } from '../lib/utils';

const NODE_SIBLING_RAIL_NAME = 'NodeSiblingRail';

export type NodeSiblingRailProps = {
  nodes: NodeEntry[];
  selectedNodeId?: string;
  onSelect: (nodeId: string) => void;
  onNavigate: (path: string) => void;
  onNavigateUp: () => void;
};

const rowClasses =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors';

export const NodeSiblingRail = ({
  nodes,
  selectedNodeId,
  onSelect,
  onNavigate,
  onNavigateUp,
}: NodeSiblingRailProps): ReactElement => {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation();

  // Selection moves through the URL and shifts no focus, so nothing scrolls the row into
  // view on its own; `nodes` is a dependency because a rebase swaps the list under it.
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedNodeId, nodes]);

  return (
    <div
      data-component={NODE_SIBLING_RAIL_NAME}
      className="border-border bg-card flex w-60 shrink-0 flex-col overflow-y-auto border-r p-2"
    >
      <button
        type="button"
        aria-label={t('node.action.backToList')}
        className={cn(rowClasses, 'hover:bg-row-hover')}
        onClick={onNavigateUp}
      >
        <ArrowLeft className="text-muted-foreground size-3.5 shrink-0" />
        <span className="text-muted-foreground font-mono text-[13px]">{t('node.rail.parent')}</span>
      </button>
      {nodes.map((node) => {
        const selected = node._id === selectedNodeId;
        const Icon = node.hasChildren ? Folder : FileText;

        return (
          <button
            key={node._id}
            ref={selected ? selectedRef : undefined}
            type="button"
            data-state={selected ? 'selected' : undefined}
            aria-current={selected ? 'true' : undefined}
            title={node._name}
            className={cn(
              rowClasses,
              'data-[state=selected]:bg-accent-muted',
              !selected && 'hover:bg-row-hover',
            )}
            onClick={() => {
              if (node.hasChildren) {
                onNavigate(node._path);
                return;
              }
              onSelect(node._id);
            }}
          >
            <Icon className="text-muted-foreground size-3.5 shrink-0" />
            <span className="truncate font-mono text-[13px]">{node._name}</span>
          </button>
        );
      })}
    </div>
  );
};

NodeSiblingRail.displayName = NODE_SIBLING_RAIL_NAME;
