/** Stopped runs remain in totals but do not contribute to the evaluated pass rate. */
export function calculatePassRate(passedRuns: number, totalRuns: number, stoppedRuns = 0): number {
  const evaluatedRuns = totalRuns - stoppedRuns;
  return evaluatedRuns <= 0 ? 0 : passedRuns / evaluatedRuns;
}
