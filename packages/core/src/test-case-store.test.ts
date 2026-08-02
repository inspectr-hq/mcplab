import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCaseFile } from './test-case-store.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('createTestCaseFile', () => {
  it('validates server references and creates a canonical Test Case exactly once', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-test-case-store-'));
    temporaryRoots.push(root);

    const created = createTestCaseFile({
      librariesDir: root,
      knownServerIds: ['mcp-lab'],
      testCase: {
        id: 'list-library',
        name: 'List Library',
        servers: ['mcp-lab'],
        prompt: 'List the MCPLab library.',
        requiredTools: ['mcplab_list_library']
      }
    });

    expect(created.testCase).toMatchObject({
      id: 'list-library',
      servers: ['mcp-lab'],
      eval: { tool_constraints: { required_tools: ['mcplab_list_library'] } }
    });
    expect(existsSync(join(root, 'test-cases', 'list-library.yaml'))).toBe(true);
    expect(() =>
      createTestCaseFile({
        librariesDir: root,
        knownServerIds: ['mcp-lab'],
        testCase: { id: 'list-library', servers: ['mcp-lab'], prompt: 'Duplicate.' }
      })
    ).toThrow("Test Case 'list-library' already exists.");
    expect(() =>
      createTestCaseFile({
        librariesDir: root,
        knownServerIds: ['mcp-lab'],
        testCase: { id: 'unknown-server', servers: ['not-configured'], prompt: 'Invalid.' }
      })
    ).toThrow('Unknown MCP server(s): not-configured');
  });
});
