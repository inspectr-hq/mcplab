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

  it('persists canonical evaluation assertion types', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-test-case-store-'));
    roots.push(root);
    const created = createTestCaseFile({
      librariesDir: root,
      knownServerIds: ['mcp-lab'],
      testCase: {
        id: 'canonical-rules',
        servers: ['mcp-lab'],
        prompt: 'Run the complete canonical check.',
        eval: {
          tool_sequence: ['search', 'fetch'],
          response_assertions: [
            { type: 'contains', value: 'Paris' },
            { type: 'not_contains', value: 'error' },
            { type: 'starts_with', value: 'Weather' },
            { type: 'ends_with', value: '°C' },
            { type: 'equals', value: 'Weather: 20°C' },
            { type: 'regex', pattern: '20°C' },
            { type: 'jsonpath_exists', path: '$.forecast' },
            { type: 'jsonpath_not_exists', path: '$.error' },
            { type: 'jsonpath', path: '$.days', equals: 5 }
          ],
          tool_input_assertions: [
            { type: 'contains', tool: 'search', value: 'Paris' },
            { type: 'regex', tool: 'fetch', pattern: 'forecast' },
            { type: 'jsonpath', tool: 'fetch', path: '$.days', equals: 5 }
          ],
          agent_assertions: [{ label: 'Complete', prompt: 'Is the answer complete?' }],
          agent_context: {
            include_prompt: true,
            include_tool_sequence: true,
            include_tool_inputs: true
          }
        }
      }
    });

    expect(created.testCase.eval).toMatchObject({
      tool_sequence: ['search', 'fetch'],
      response_assertions: expect.arrayContaining([
        { type: 'contains', value: 'Paris' },
        { type: 'jsonpath', path: '$.days', equals: 5 }
      ]),
      tool_input_assertions: expect.arrayContaining([
        { type: 'contains', tool: 'search', value: 'Paris' }
      ]),
      agent_assertions: [{ label: 'Complete', prompt: 'Is the answer complete?' }],
      agent_context: {
        include_prompt: true,
        include_tool_sequence: true,
        include_tool_inputs: true
      }
    });
  });

  it('rejects conflicting convenience and canonical response checks', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-test-case-store-'));
    roots.push(root);
    expect(() =>
      createTestCaseFile({
        librariesDir: root,
        knownServerIds: ['mcp-lab'],
        testCase: {
          id: 'conflicting-rules',
          servers: ['mcp-lab'],
          prompt: 'Run the conflicting check.',
          responseRegexPatterns: ['Paris'],
          eval: { response_assertions: [{ type: 'contains', value: 'Paris' }] }
        }
      })
    ).toThrow(
      'Provide response_regex_patterns either as a convenience field or in eval.response_assertions'
    );
  });

  it('ignores empty canonical arrays when merging shorthand rules', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-test-case-store-'));
    roots.push(root);
    const created = createTestCaseFile({
      librariesDir: root,
      knownServerIds: ['mcp-lab'],
      testCase: {
        id: 'empty-canonical-rules',
        servers: ['mcp-lab'],
        prompt: 'Run the check.',
        requiredTools: ['search'],
        forbiddenTools: ['delete'],
        toolSequence: ['search'],
        responseRegexPatterns: ['done'],
        eval: {
          tool_constraints: { required_tools: [], forbidden_tools: [] },
          tool_sequence: [],
          response_assertions: []
        }
      }
    });

    expect(created.testCase.eval).toMatchObject({
      tool_constraints: { required_tools: ['search'], forbidden_tools: ['delete'] },
      tool_sequence: ['search'],
      response_assertions: [{ type: 'regex', pattern: 'done' }]
    });
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
    ).toThrow('already used by another Test Case');
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
