import { describe, expect, it } from 'vitest';
import { isWriteDeleteClassification, safeJsonStringify } from './tool-analysis-utils';

describe('isWriteDeleteClassification', () => {
  it('returns true for side-effectful prefix reason', () => {
    expect(
      isWriteDeleteClassification("Name starts with potentially side-effectful prefix 'delete'.")
    ).toBe(true);
  });

  it('returns true for destructive behavior annotation reason', () => {
    expect(
      isWriteDeleteClassification(
        "MCP annotations indicate destructive behavior ('destructiveHint: true')."
      )
    ).toBe(true);
  });

  it('returns true for destructiveHint mention in reason', () => {
    expect(isWriteDeleteClassification('destructiveHint: true')).toBe(true);
  });

  it('returns false for read-like classification', () => {
    expect(isWriteDeleteClassification("Name starts with read-like prefix 'get'.")).toBe(false);
  });

  it('returns false for unknown/other unsafe reason', () => {
    expect(
      isWriteDeleteClassification('Tool name does not match read-only allowlist prefixes.')
    ).toBe(false);
  });
});

describe('safeJsonStringify', () => {
  it('serializes normal objects', () => {
    expect(safeJsonStringify({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('returns fallback string on circular reference', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(safeJsonStringify(circular)).toBe('[schema not serializable]');
  });
});
