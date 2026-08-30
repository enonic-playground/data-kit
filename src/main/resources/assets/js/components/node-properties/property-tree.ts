//
// * Types
//

export type PropertyKind = 'set' | 'array' | 'scalar';

export type PropertyType = {
  label: string;
  /** XP flattens Reference, GeoPoint, dates and BinaryReference into plain JS values, so
   *  anything recovered by pattern is a guess and must be presented as one. */
  inferred: boolean;
};

export type PropertyNode = {
  name: string;
  path: string;
  kind: PropertyKind;
  type: PropertyType;
  value: unknown;
  index?: number;
  children?: PropertyNode[];
};

export type PropertyRow = {
  node: PropertyNode;
  depth: number;
};

//
// * Constants
//

const SYSTEM_KEY_PREFIX = '_';

/** Collections above this size stay collapsed on first render. */
export const LARGE_COLLECTION_SIZE = 20;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const LOCAL_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_REGEX = /^\d{2}:\d{2}:\d{2}(\.\d+)?$/;
const GEO_POINT_REGEX = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

//
// * Type detection
//

const certain = (label: string): PropertyType => ({ label, inferred: false });
const guess = (label: string): PropertyType => ({ label, inferred: true });

export function detectPropertyType(value: unknown, binaryReference?: string): PropertyType {
  if (value == null) return certain('null');
  if (Array.isArray(value)) return certain('Array');
  if (typeof value === 'object') return certain('PropertySet');
  if (typeof value === 'boolean') return certain('Boolean');
  if (typeof value === 'number') {
    // A fractional JS number cannot have come from an XP Long; an integer could be either.
    return Number.isInteger(value) ? guess('Long') : certain('Double');
  }
  if (typeof value === 'string') {
    if (binaryReference != null && value === binaryReference) return guess('BinaryReference');
    if (UUID_REGEX.test(value)) return guess('Reference');
    if (DATE_TIME_REGEX.test(value)) return guess('DateTime');
    if (LOCAL_DATE_REGEX.test(value)) return guess('LocalDate');
    if (LOCAL_TIME_REGEX.test(value)) return guess('LocalTime');
    if (GEO_POINT_REGEX.test(value)) return guess('GeoPoint');
    return certain('String');
  }
  return certain(typeof value);
}

//
// * Model
//

function kindOf(value: unknown): PropertyKind {
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'set';
  return 'scalar';
}

function buildChildren(value: unknown, path: string, binaryReference?: string): PropertyNode[] {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      buildNode(String(index), `${path}[${index}]`, item, binaryReference, index),
    );
  }
  return Object.entries(value as Record<string, unknown>).map(([key, child]) =>
    buildNode(key, `${path}.${key}`, child, binaryReference),
  );
}

function buildNode(
  name: string,
  path: string,
  value: unknown,
  binaryReference?: string,
  index?: number,
): PropertyNode {
  const kind = kindOf(value);
  const node: PropertyNode = {
    name,
    path,
    kind,
    type: detectPropertyType(value, binaryReference),
    value,
  };
  if (index !== undefined) node.index = index;
  if (kind !== 'scalar') node.children = buildChildren(value, path, binaryReference);
  return node;
}

export function buildPropertyTree(
  node: Record<string, unknown>,
  binaryReference?: string,
): PropertyNode[] {
  return Object.keys(node)
    .filter((key) => !key.startsWith(SYSTEM_KEY_PREFIX))
    .map((key) => buildNode(key, key, node[key], binaryReference));
}

//
// * Expansion
//

export function defaultExpandedPaths(nodes: readonly PropertyNode[]): Set<string> {
  const expanded = new Set<string>();
  const walk = (list: readonly PropertyNode[]): void => {
    for (const node of list) {
      if (node.children == null || node.children.length === 0) continue;
      if (node.children.length <= LARGE_COLLECTION_SIZE) expanded.add(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return expanded;
}

export function flattenPropertyTree(
  nodes: readonly PropertyNode[],
  expandedPaths: ReadonlySet<string>,
): PropertyRow[] {
  const rows: PropertyRow[] = [];
  const walk = (list: readonly PropertyNode[], depth: number): void => {
    for (const node of list) {
      rows.push({ node, depth });
      if (node.children != null && expandedPaths.has(node.path)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return rows;
}

export function formatScalar(value: unknown): string {
  if (value == null) return 'null';
  return String(value);
}
