import { appendFileSync } from 'node:fs';
import type { PersistedTraceRecord, TraceEvent } from './types.js';

export class TraceWriter {
  constructor(private readonly path: string) {}

  write(event: TraceEvent | PersistedTraceRecord): void {
    appendFileSync(this.path, `${JSON.stringify(event)}\n`, 'utf8');
  }
}
