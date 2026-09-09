import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendExecutionEvent, readExecutionEvents, writeAtomicText } from './execution-journal.js';

describe('execution journal', () => {
  it('appends and replays valid events while ignoring a truncated final line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-journal-'));
    try {
      appendExecutionEvent(dir, { eventId: 'e1', type: 'started', ts: '2026-09-09T00:00:00.000Z' });
      appendExecutionEvent(dir, { eventId: 'e2', type: 'completed', ts: '2026-09-09T00:00:01.000Z', executionId: 'x' });
      writeFileSync(join(dir, 'execution-events.jsonl'), `${readExecutionEvents(dir).map((event) => JSON.stringify(event)).join('\n')}\n{"eventId":"truncated"`, 'utf8');
      expect(readExecutionEvents(dir).map((event) => event.eventId)).toEqual(['e1', 'e2']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes projections through a temporary file and rename', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcplab-journal-'));
    try {
      const target = join(dir, 'results.json');
      writeAtomicText(target, '{"status":"running"}\n');
      expect(readExecutionEvents(dir)).toEqual([]);
      expect(JSON.parse(readFileSync(target, 'utf8')).status).toBe('running');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
