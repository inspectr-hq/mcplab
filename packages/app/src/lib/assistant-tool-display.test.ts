import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  toolCallDuration,
  toolCallFields,
  toolCallRisks,
  toolCallSummary,
  toolCallTitle
} from './assistant-tool-display';

const base = { tool: 'write_report', arguments: {}, status: 'approved' as const };

describe('tool call display', () => {
  it("prefers the tool's own title and otherwise makes its name readable", () => {
    expect(toolCallTitle({ tool: 'post_to_slack', title: 'Post to Slack' })).toBe('Post to Slack');
    expect(toolCallTitle({ tool: 'mcplab_write_markdown_report' })).toBe('Write markdown report');
    expect(toolCallTitle({ tool: 'listOpenIssues' })).toBe('List open issues');
  });

  it('turns MCP hints into risks, and shows none for read-only tools', () => {
    expect(toolCallRisks({ hints: { destructive: true, openWorld: true } })).toEqual([
      { label: 'Can change or delete data', tone: 'danger' },
      { label: 'Reaches external systems', tone: 'caution' }
    ]);
    expect(toolCallRisks({ hints: { readOnly: true, openWorld: true } })).toEqual([]);
    expect(toolCallRisks({})).toEqual([]);
  });

  it('labels argument fields from schema titles or readable keys', () => {
    expect(
      toolCallFields({
        arguments: { channel: '#growth', max_results: 5, filter: { a: 1 } },
        argumentLabels: { channel: 'Slack channel' }
      })
    ).toEqual([
      { key: 'channel', label: 'Slack channel', value: '#growth' },
      { key: 'max_results', label: 'Max results', value: '5' },
      { key: 'filter', label: 'Filter', value: '{"a":1}' }
    ]);
    expect(toolCallFields({ arguments: ['not', 'an', 'object'] })).toBeUndefined();
  });

  it('formats durations only for calls that finished', () => {
    expect(toolCallDuration({ startedAt: '2026-10-16T10:00:00.000Z' })).toBeUndefined();
    expect(
      toolCallDuration({
        startedAt: '2026-10-16T10:00:00.000Z',
        completedAt: '2026-10-16T10:00:01.540Z'
      })
    ).toBe('1.5s');
    expect(formatDuration(340)).toBe('340ms');
    expect(formatDuration(75_000)).toBe('1m 15s');
  });

  it('summarizes a call by its error, its resource or prompt, or its first argument', () => {
    expect(
      toolCallSummary({ ...base, status: 'error', error: 'Timed out', arguments: { q: 'x' } })
    ).toBe('Timed out');
    expect(
      toolCallSummary({ ...base, tool: 'read_mcp_resource', arguments: { uri: 'docs://guide' } })
    ).toBe('docs://guide');
    expect(toolCallSummary({ ...base, tool: 'list_mcp_prompts', arguments: {} })).toBe(
      'All servers'
    );
    expect(toolCallSummary({ ...base, arguments: { flag: true, tag: 'TM-104' } })).toBe('TM-104');
  });
});
