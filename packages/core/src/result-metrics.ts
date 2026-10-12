/** Stopped runs remain in totals but do not contribute to the pass rate. Returns null when nothing was evaluated. */
export function calculatePassRate(
  passedRuns: number,
  totalRuns: number,
  stoppedRuns = 0
): number | null {
  const evaluatedRuns = totalRuns - stoppedRuns;
  return evaluatedRuns <= 0 ? null : passedRuns / evaluatedRuns;
}
