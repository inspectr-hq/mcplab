import { describe, expect, it } from 'vitest';
import { parseAnalysisProgressFromEvents } from './ToolAnalysis';

describe('parseAnalysisProgressFromEvents', () => {
  it('parses selected tool count from new log format "(N selected of M discovered)"', () => {
    const events = [{ payload: { message: 'Analyzing server demo (3 selected of 5 discovered)' } }];
    const result = parseAnalysisProgressFromEvents(events);
    expect(result.totalTools).toBe(3);
  });

  it('tracks started and finished tools from log messages', () => {
    const events = [
      { payload: { message: 'Analyzing server demo (2 selected of 2 discovered)' } },
      { payload: { message: 'Started demo::get_user' } },
      { payload: { message: 'Finished demo::get_user' } }
    ];
    const result = parseAnalysisProgressFromEvents(events);
    expect(result.startedTools).toBe(1);
    expect(result.finishedTools).toBe(1);
    expect(result.percent).toBe(50);
  });

  it('returns zero percent when no tools discovered yet', () => {
    const result = parseAnalysisProgressFromEvents([]);
    expect(result.totalTools).toBe(0);
    expect(result.percent).toBe(0);
  });

  it('does NOT match the old "(N tools)" format', () => {
    const events = [{ payload: { message: 'Analyzing server demo (5 tools)' } }];
    const result = parseAnalysisProgressFromEvents(events);
    expect(result.totalTools).toBe(0);
  });
});
