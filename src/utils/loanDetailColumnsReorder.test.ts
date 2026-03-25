import { describe, expect, it } from 'vitest';
import {
  arrayMoveToFinalIndex,
  moveRowToEndByIndex,
  moveRowToOneBasedPosition,
} from '@/utils/loanDetailColumnsReorder';

describe('arrayMoveToFinalIndex', () => {
  it('moves last item to middle', () => {
    expect(arrayMoveToFinalIndex(['A', 'B', 'C'], 2, 1)).toEqual(['A', 'C', 'B']);
  });
  it('moves first item to end', () => {
    expect(arrayMoveToFinalIndex(['A', 'B', 'C'], 0, 2)).toEqual(['B', 'C', 'A']);
  });
  it('moves middle item down', () => {
    expect(arrayMoveToFinalIndex(['A', 'B', 'C', 'D'], 1, 3)).toEqual(['A', 'C', 'D', 'B']);
  });
  it('no-ops when from equals to', () => {
    expect(arrayMoveToFinalIndex(['A', 'B'], 1, 1)).toEqual(['A', 'B']);
  });
});

describe('moveRowToOneBasedPosition', () => {
  it('moves FICO from position 3 to 2 (1-based)', () => {
    const list = ['Loan number', 'Volume', 'FICO'];
    expect(moveRowToOneBasedPosition(list, 2, 2)).toEqual(['Loan number', 'FICO', 'Volume']);
  });
  it('clamps high positions to list length', () => {
    const list = ['a', 'b', 'c'];
    expect(moveRowToOneBasedPosition(list, 0, 99)).toEqual(['b', 'c', 'a']);
  });
  it('clamps below 1 to position 1', () => {
    const list = ['a', 'b', 'c'];
    expect(moveRowToOneBasedPosition(list, 2, 0)).toEqual(['c', 'a', 'b']);
  });
});

describe('moveRowToEndByIndex', () => {
  it('moves first to end', () => {
    expect(moveRowToEndByIndex(['A', 'B', 'C'], 0)).toEqual(['B', 'C', 'A']);
  });
  it('no-op for last', () => {
    expect(moveRowToEndByIndex(['A', 'B'], 1)).toEqual(['A', 'B']);
  });
});
