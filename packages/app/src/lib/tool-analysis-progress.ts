type ProgressEvent = { payload?: { message?: unknown } };

export function parseAnalysisProgressFromEvents(events: ProgressEvent[]): {
  totalTools: number;
  startedTools: number;
  finishedTools: number;
  percent: number;
} {
  let totalTools = 0;
  const started = new Set<string>();
  const finished = new Set<string>();
  for (const event of events) {
    const message = typeof event.payload?.message === 'string' ? event.payload.message : '';
    if (!message) continue;
    const totalMatch = message.match(/\((\d+)\s+selected\s+of\s+\d+\s+discovered\)/i);
    if (totalMatch) {
      totalTools = Math.max(totalTools, Number(totalMatch[1]) || 0);
    }
    const startedMatch = message.match(/^Started\s+(.+)$/);
    if (startedMatch) started.add(startedMatch[1]);
    const finishedMatch = message.match(/^Finished\s+(.+)$/);
    if (finishedMatch) finished.add(finishedMatch[1]);
  }
  const percent =
    totalTools > 0 ? Math.max(0, Math.min(100, Math.round((finished.size / totalTools) * 100))) : 0;
  return { totalTools, startedTools: started.size, finishedTools: finished.size, percent };
}
