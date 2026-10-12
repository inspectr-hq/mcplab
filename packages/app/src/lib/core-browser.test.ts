import { describe, expect, it } from 'vitest';
import * as core from '@inspectr/mcplab-core';

describe('core package in the UI', () => {
  it('loads browser helpers without the Node evaluation engine', () => {
    expect(core.calculatePassRate).toBeTypeOf('function');
    expect(core).not.toHaveProperty('McpClientManager');
    expect(core).not.toHaveProperty('runAll');
  });
});
