import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

export interface ExecutionJournalEvent {
  eventId: string;
  type: string;
  ts: string;
  executionId?: string;
  [key: string]: unknown;
}

export function journalPath(runDir: string): string {
  return join(runDir, 'execution-events.jsonl');
}

export function appendExecutionEvent(runDir: string, event: ExecutionJournalEvent): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(journalPath(runDir), `${JSON.stringify(event)}\n`, 'utf8');
}

export function readExecutionEvents(runDir: string): ExecutionJournalEvent[] {
  const path = journalPath(runDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as ExecutionJournalEvent;
        return value && typeof value.eventId === 'string' && typeof value.type === 'string'
          ? [value]
          : [];
      } catch {
        return [];
      }
    });
}

export function readLatestResultSnapshot(runDir: string): ExecutionJournalEvent | null {
  const snapshots = readExecutionEvents(runDir).filter((event) => event.type === 'result_snapshot');
  return snapshots[snapshots.length - 1] ?? null;
}

export function writeAtomicText(path: string, content: string): void {
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, content, 'utf8');
  renameSync(temporaryPath, path);
}
