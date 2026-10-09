import { describe, expect, it } from 'vitest';
import { calculatePassRate } from './result-metrics.js';

describe('calculatePassRate', () => {
  it.each([
    [1, 2, 1, 1],
    [1, 3, 1, 0.5],
    [1, 2, undefined, 0.5],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
    [0, 1, 2, 0]
  ])('calculates passed=%s total=%s stopped=%s', (passed, total, stopped, expected) => {
    expect(calculatePassRate(passed, total, stopped)).toBe(expected);
  });
});
