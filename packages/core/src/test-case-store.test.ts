import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCaseFile, readTestCaseFile, updateTestCaseFile } from './test-case-store.js';

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
    expect(created.testCase.mcp_servers).toEqual([{ ref: 'mcp-lab' }]);
    expect(existsSync(join(root, 'test-cases', 'library-check.yaml'))).toBe(true);
  });

  it('preserves generated constraints, sequences, and extract rules', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-test-case-store-'));
    roots.push(root);
    const created = createTestCaseFile({
      librariesDir: root,
      knownServerIds: ['mcp-lab'],
      testCase: {
        id: 'full-case',
        servers: ['mcp-lab'],
        prompt: 'Run the complete check.',
        requiredTools: ['search'],
        forbiddenTools: ['delete'],
        toolSequence: ['search', 'fetch'],
        responseRegexPatterns: ['done'],
        extractRules: [{ name: 'value', regex: 'value: (.*)' }]
      }
    });
    expect(created.testCase.eval).toMatchObject({
      tool_constraints: { required_tools: ['search'], forbidden_tools: ['delete'] },
      tool_sequence: ['search', 'fetch'],
      response_assertions: [{ type: 'regex', pattern: 'done' }]
    });
    expect(created.testCase.extract).toEqual([
      { name: 'value', from: 'final_text', regex: 'value: (.*)' }
    ]);
  });

  it('defaults whitespace-only names to the test case id', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-test-case-store-'));
    roots.push(root);
    const created = createTestCaseFile({
      librariesDir: root,
      knownServerIds: ['mcp-lab'],
      testCase: {
        id: 'whitespace-name',
        name: '   ',
        servers: ['mcp-lab'],
        prompt: 'Run the check.'
      }
    });

    expect(created.testCase.name).toBe('whitespace-name');
  });

  it('reads and updates an existing test case in place', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-test-case-store-'));
    roots.push(root);
    createTestCaseFile({
      librariesDir: root,
      knownServerIds: ['mcp-lab'],
      testCase: { id: 'editable', servers: ['mcp-lab'], prompt: 'Before' }
    });
    expect(
      readTestCaseFile({ librariesDir: root, filePath: 'editable.yaml' }).testCase.prompt
    ).toBe('Before');
    const updated = updateTestCaseFile({
      librariesDir: root,
      knownServerIds: ['mcp-lab'],
      filePath: 'editable.yaml',
      testCase: { id: 'editable', servers: ['mcp-lab'], prompt: 'After' }
    });
    expect(updated.testCase.prompt).toBe('After');
  });

  it('rejects updating a test case to an id already used by another file', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-test-case-store-'));
    roots.push(root);
    createTestCaseFile({
      librariesDir: root,
      knownServerIds: ['mcp-lab'],
      testCase: { id: 'first', servers: ['mcp-lab'], prompt: 'First case.' }
    });
    createTestCaseFile({
      librariesDir: root,
      knownServerIds: ['mcp-lab'],
      testCase: { id: 'second', servers: ['mcp-lab'], prompt: 'Second case.' }
    });

    expect(() =>
      updateTestCaseFile({
        librariesDir: root,
        knownServerIds: ['mcp-lab'],
        filePath: 'first.yaml',
        testCase: { id: 'second', servers: ['mcp-lab'], prompt: 'Renamed case.' }
      })
    ).toThrow("already used by another Test Case");
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
