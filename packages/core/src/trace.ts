import { appendFileSync } from 'node:fs';
import type { TraceEvent } from './types.js';

export class TraceWriter {
  constructor(private readonly path: string) {}

  write(event: TraceEvent): void {
    appendFileSync(this.path, `${JSON.stringify(event)}\n`, 'utf8');
  }
}
