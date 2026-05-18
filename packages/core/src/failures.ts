import type { FailureEntry } from './types.js';

export function normalizeFailureEntry(input: unknown): FailureEntry {
  if (typeof input === 'string') return { message: input, severity: 'error' };
  if (
    input &&
    typeof input === 'object' &&
    typeof (input as { message?: unknown }).message === 'string'
  ) {
    return {
      message: (input as { message: string }).message,
      severity: (input as { severity?: unknown }).severity === 'warning' ? 'warning' : 'error'
    };
  }
  return { message: String(input ?? ''), severity: 'error' };
}

export function failureMessage(input: unknown): string {
  return normalizeFailureEntry(input).message;
}
