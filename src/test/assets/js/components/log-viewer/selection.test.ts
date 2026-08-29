import { describe, expect, it } from 'vitest';

import type {
  LogSelection,
  SelectionSpan,
} from '../../../../../main/resources/assets/js/components/log-viewer/selection';

import {
  comparePoints,
  isCollapsed,
  orderSpan,
  samePoint,
  serializeSelection,
  spanLength,
} from '../../../../../main/resources/assets/js/components/log-viewer/selection';

const LINES = ['first line', 'second line', 'third line', 'fourth line'];

function buildSelection(overrides?: Partial<LogSelection>): LogSelection {
  return {
    anchor: { index: 0, offset: 0 },
    focus: { index: 3, offset: 5 },
    ...overrides,
  };
}

function buildSpan(overrides?: Partial<SelectionSpan>): SelectionSpan {
  return {
    start: { index: 0, offset: 0 },
    end: { index: 3, offset: LINES[3].length },
    ...overrides,
  };
}

const fromArray =
  (lines: readonly (string | undefined)[]) =>
  (index: number): string | undefined =>
    lines[index];

describe('comparePoints / samePoint', () => {
  it('orders by index before offset', () => {
    expect(comparePoints({ index: 1, offset: 99 }, { index: 2, offset: 0 })).toBeLessThan(0);
    expect(comparePoints({ index: 2, offset: 1 }, { index: 2, offset: 0 })).toBeGreaterThan(0);
    expect(comparePoints({ index: 2, offset: 3 }, { index: 2, offset: 3 })).toBe(0);
  });

  it('treats two nulls as the same point and one null as different', () => {
    expect(samePoint(null, null)).toBe(true);
    expect(samePoint({ index: 0, offset: 0 }, null)).toBe(false);
  });
});

describe('orderSpan', () => {
  it('leaves a forward selection alone', () => {
    const span = orderSpan(buildSelection());
    expect(span.start.index).toBe(0);
    expect(span.end.index).toBe(3);
  });

  it('swaps a selection dragged upwards', () => {
    const span = orderSpan(
      buildSelection({ anchor: { index: 3, offset: 5 }, focus: { index: 0, offset: 2 } }),
    );
    expect(span.start).toEqual({ index: 0, offset: 2 });
    expect(span.end).toEqual({ index: 3, offset: 5 });
  });
});

describe('isCollapsed / spanLength', () => {
  it('reports a caret as collapsed', () => {
    expect(isCollapsed(buildSelection({ focus: { index: 0, offset: 0 } }))).toBe(true);
    expect(isCollapsed(buildSelection())).toBe(false);
  });

  it('counts both ends of the span', () => {
    expect(spanLength(buildSpan())).toBe(4);
    expect(spanLength(buildSpan({ end: { index: 0, offset: 3 } }))).toBe(1);
  });
});

describe('serializeSelection', () => {
  it('slices the first and last lines and keeps the ones between whole', () => {
    const result = serializeSelection(
      buildSpan({ start: { index: 0, offset: 6 }, end: { index: 2, offset: 5 } }),
      fromArray(LINES),
    );

    expect(result.text).toBe('line\nsecond line\nthird');
    expect(result.copied).toBe(3);
    expect(result.total).toBe(3);
  });

  it('slices within a single line', () => {
    const result = serializeSelection(
      buildSpan({ start: { index: 1, offset: 0 }, end: { index: 1, offset: 6 } }),
      fromArray(LINES),
    );

    expect(result.text).toBe('second');
    expect(result.total).toBe(1);
  });

  // ! Oversized rows render a truncated head, so a DOM offset can sit past the end of the text
  // ! the row actually holds.
  it('clamps offsets past the end of a line', () => {
    const result = serializeSelection(
      buildSpan({ start: { index: 1, offset: 500 }, end: { index: 2, offset: 500 } }),
      fromArray(LINES),
    );

    expect(result.text).toBe('\nthird line');
  });

  it('reports how short the buffer came, without inventing the missing lines', () => {
    const result = serializeSelection(
      buildSpan({ start: { index: 0, offset: 0 }, end: { index: 3, offset: 6 } }),
      fromArray([LINES[0], undefined, undefined, LINES[3]]),
    );

    expect(result.text).toBe('first line\nfourth');
    expect(result.copied).toBe(2);
    expect(result.total).toBe(4);
  });

  it('produces nothing at all when no line is available', () => {
    const result = serializeSelection(buildSpan(), fromArray([]));

    expect(result.text).toBe('');
    expect(result.copied).toBe(0);
    expect(result.total).toBe(4);
  });
});
