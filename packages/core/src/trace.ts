import { appendFileSync } from 'node:fs';
import type { PersistedTraceRecord } from './types.js';

export class TraceWriter {
  constructor(private readonly path: string) {}

  write(record: PersistedTraceRecord): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, 'utf8');
  }
}
