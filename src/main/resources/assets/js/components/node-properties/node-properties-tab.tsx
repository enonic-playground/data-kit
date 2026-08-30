import { ChevronRight, Download, Table2 } from 'lucide-react';
import { type ReactElement, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { NodeDetail, NodeImageDetail } from '../../lib/api/nodes';
import type { PropertyNode } from './property-tree';

import { buildBinaryDownloadUrl } from '../../lib/api/binary';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  buildPropertyTree,
  defaultExpandedPaths,
  flattenPropertyTree,
  formatScalar,
} from './property-tree';

//
// * Types
//

export type NodePropertiesTabProps = {
  node: NodeDetail;
  repoId: string;
  branch: string;
  image?: NodeImageDetail;
  onNavigateToNode?: (nodeId: string) => void;
};

type Expansion = {
  nodeId: string;
  paths: ReadonlySet<string>;
};

const NODE_PROPERTIES_TAB_NAME = 'NodePropertiesTab';

const INDENT_STEP_PX = 14;

//
// * Helpers
//

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

//
// * PropertyValueCell
//

const PROPERTY_VALUE_CELL_NAME = 'PropertyValueCell';

type PropertyValueCellProps = {
  property: PropertyNode;
  nodeId: string;
  repoId: string;
  branch: string;
  image?: NodeImageDetail;
  onNavigateToNode?: (nodeId: string) => void;
};

const PropertyValueCell = ({
  property,
  nodeId,
  repoId,
  branch,
  image,
  onNavigateToNode,
}: PropertyValueCellProps): ReactElement => {
  const { t } = useTranslation();

  if (property.kind !== 'scalar') {
    const count = property.children?.length ?? 0;
    const key = property.kind === 'array' ? 'node.properties.items' : 'node.properties.members';
    return (
      <span data-component={PROPERTY_VALUE_CELL_NAME} className="text-muted-foreground text-xs">
        {t(key, { count })}
      </span>
    );
  }

  const text = formatScalar(property.value);

  if (property.type.label === 'BinaryReference') {
    return (
      <span data-component={PROPERTY_VALUE_CELL_NAME} className="flex items-start gap-1.5">
        <span className="truncate" title={text}>
          {text}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={buildBinaryDownloadUrl({
                repoId,
                branch,
                key: nodeId,
                binaryReference: text,
              })}
              download
              aria-label={t('node.properties.download', { name: property.name })}
              className={cn(
                'inline-flex size-6 shrink-0 items-center justify-center rounded-md',
                'text-muted-foreground transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="size-3.5" />
            </a>
          </TooltipTrigger>
          <TooltipContent>
            <p>{image?.mimeType ?? t('node.binary.unknownMime')}</p>
            <p>{image != null ? formatFileSize(image.size) : t('node.binary.unknownSize')}</p>
          </TooltipContent>
        </Tooltip>
      </span>
    );
  }

  if (property.type.label === 'Reference') {
    return (
      <button
        type="button"
        data-component={PROPERTY_VALUE_CELL_NAME}
        title={text}
        className={cn(
          'decoration-muted-foreground/50 hover:decoration-foreground',
          'block w-full truncate text-left underline underline-offset-2',
        )}
        onClick={() => onNavigateToNode?.(text)}
      >
        {text}
      </button>
    );
  }

  return (
    <span data-component={PROPERTY_VALUE_CELL_NAME} className="block truncate" title={text}>
      {text}
    </span>
  );
};

PropertyValueCell.displayName = PROPERTY_VALUE_CELL_NAME;

//
// * NodePropertiesTab
//

export const NodePropertiesTab = ({
  node,
  repoId,
  branch,
  image,
  onNavigateToNode,
}: NodePropertiesTabProps): ReactElement => {
  const { t } = useTranslation();

  const tree = useMemo(
    () => buildPropertyTree(node, image?.binaryReference),
    [node, image?.binaryReference],
  );
  // The panel swaps `node` in place rather than remounting, so without this re-seed the
  // previous node's expanded paths decide what the next one shows. Owned here rather than
  // via a `key` on the caller so the invariant survives being re-parented, and so it can be
  // tested without a route harness.
  const [expansion, setExpansion] = useState<Expansion>(() => ({
    nodeId: node._id,
    paths: defaultExpandedPaths(tree),
  }));
  if (expansion.nodeId !== node._id) {
    setExpansion({ nodeId: node._id, paths: defaultExpandedPaths(tree) });
  }

  const rows = useMemo(() => flattenPropertyTree(tree, expansion.paths), [tree, expansion.paths]);

  const toggleExpand = (path: string): void => {
    setExpansion((prev) => {
      const paths = new Set(prev.paths);
      if (!paths.delete(path)) paths.add(path);
      return { nodeId: prev.nodeId, paths };
    });
  };

  if (tree.length === 0) {
    return (
      <div
        data-component={NODE_PROPERTIES_TAB_NAME}
        className="text-muted-foreground flex flex-col items-center gap-2 py-8"
      >
        <Table2 className="size-8" />
        <p className="text-sm">{t('node.properties.empty')}</p>
      </div>
    );
  }

  return (
    <div data-component={NODE_PROPERTIES_TAB_NAME}>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[45%]">{t('node.properties.column.name')}</TableHead>
            <TableHead className="w-[26%]">{t('node.properties.column.type')}</TableHead>
            <TableHead>{t('node.properties.column.value')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ node: property, depth }) => {
            const expandable = property.children != null && property.children.length > 0;
            const expanded = expansion.paths.has(property.path);
            return (
              <TableRow key={property.path}>
                <TableCell
                  className="font-medium"
                  style={{ paddingLeft: `${depth * INDENT_STEP_PX + 8}px` }}
                >
                  <span className="flex min-w-0 items-center gap-1">
                    {expandable ? (
                      <button
                        type="button"
                        onClick={() => toggleExpand(property.path)}
                        aria-expanded={expanded}
                        aria-label={t(
                          expanded ? 'node.properties.collapse' : 'node.properties.expand',
                          { name: property.path },
                        )}
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded',
                          'text-muted-foreground transition-colors',
                          'hover:bg-accent hover:text-accent-foreground',
                        )}
                      >
                        <ChevronRight
                          className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
                        />
                      </button>
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    {property.index != null ? (
                      <Badge variant="outline" className="shrink-0">
                        {property.index}
                      </Badge>
                    ) : (
                      <span className="truncate" title={property.path}>
                        {property.name}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  {property.type.inferred ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* Badge is a div, so tabIndex is what makes the tooltip reachable.
                            Radix supplies the description; an aria-label would duplicate it. */}
                        <Badge variant="outline" className="border-dashed" tabIndex={0}>
                          {property.type.label}
                          <span aria-hidden className="text-muted-foreground ml-0.5">
                            ?
                          </span>
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t('node.properties.inferredType', { type: property.type.label })}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <Badge variant="secondary">{property.type.label}</Badge>
                  )}
                </TableCell>
                <TableCell className="min-w-0 font-mono text-sm">
                  <PropertyValueCell
                    property={property}
                    nodeId={node._id}
                    repoId={repoId}
                    branch={branch}
                    image={image}
                    onNavigateToNode={onNavigateToNode}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

NodePropertiesTab.displayName = NODE_PROPERTIES_TAB_NAME;
