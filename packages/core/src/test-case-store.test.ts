import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCaseFile } from './test-case-store.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('createTestCaseFile', () => {
  it('persists a validated Test Case under test-cases', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-test-case-store-'));
    roots.push(root);
    const created = createTestCaseFile({
      librariesDir: root,
      knownServerIds: ['mcp-lab'],
      testCase: {
        id: 'library-check',
        servers: ['mcp-lab'],
        prompt: 'List the library entries.',
        requiredTools: ['mcplab_list_library']
      }
    });
    expect(created.id).toBe('library-check');
    expect(created.testCase.eval?.tool_constraints?.required_tools).toEqual([
      'mcplab_list_library'
    ]);
    expect(existsSync(join(root, 'test-cases', 'library-check.yaml'))).toBe(true);
  });

  it('rejects unknown servers and duplicate IDs', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-test-case-store-'));
    roots.push(root);
    const input = {
      librariesDir: root,
      knownServerIds: ['mcp-lab'],
      testCase: { id: 'duplicate', servers: ['missing'], prompt: 'Run it.' }
    };
    expect(() => createTestCaseFile(input)).toThrow('Unknown MCP server');
    createTestCaseFile({ ...input, testCase: { ...input.testCase, servers: ['mcp-lab'] } });
    expect(() =>
      createTestCaseFile({ ...input, testCase: { ...input.testCase, servers: ['mcp-lab'] } })
    ).toThrow('already exists');
  });
});
