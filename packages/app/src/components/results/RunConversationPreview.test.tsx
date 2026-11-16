import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RunConversationPreview } from './RunConversationPreview';
import { ConversationRow } from './ScenarioEvidence';
import type { ScenarioRun } from '@/types/eval';

describe('RunConversationPreview', () => {
  it('renders estimated token suffixes for tool call and result rows', async () => {
    const run: ScenarioRun = {
      runIndex: 0,
      passed: true,
      toolCalls: [],
      assistantTokenUsage: null,
      toolTokenUsage: null,
      toolTokenUsageByTool: {},
      finalAnswer: 'Done',
      duration: 0,
      extractedValues: {},
      failureReasons: [],
      conversation: [
        {
          id: 'tool-call-1',
          kind: 'tool_call',
          text: '{"q":"alpha"}',
          toolName: 'search_tags',
          estimatedTokens: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 }
        },
        {
          id: 'tool-result-1',
          kind: 'tool_result',
          text: '{"hits":1}',
          toolName: 'search_tags',
          ok: true,
          durationMs: 704,
          estimatedTokens: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 }
        }
      ]
    };

    render(<RunConversationPreview run={run} />);
    fireEvent.click(screen.getByRole('button', { name: /Conversation trace/i }));

    expect(
      await screen.findByText('Tool call · search_tags · estimated 1,000 tokens')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Tool result · search_tags · ok · 704ms · estimated 200 tokens')
    ).toBeInTheDocument();
  });

  it('formats valid JSON tool results only when requested', async () => {
    render(
      <ConversationRow
        item={{
          id: 'tool-result-1',
          kind: 'tool_result',
          text: '{"hits":1,"nested":{"ok":true}}',
          toolName: 'search_tags',
          ok: true
        }}
      />
    );
    expect(screen.getByRole('button', { name: 'Format JSON' })).toBeInTheDocument();
    expect(screen.queryByText('Show raw')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Format JSON' }));
    fireEvent.click(screen.getByRole('button', { name: /Tool result · search_tags/ }));

    expect(
      await screen.findByText((_, element) =>
        element?.tagName === 'PRE' &&
        element.textContent === '{\n  "hits": 1,\n  "nested": {\n    "ok": true\n  }\n}'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show raw' }));
    expect(screen.getByText('{"hits":1,"nested":{"ok":true}}')).toBeInTheDocument();
  });

  it('does not offer JSON formatting for plain text tool results', async () => {
    render(
      <ConversationRow
        item={{
          id: 'tool-result-1',
          kind: 'tool_result',
          text: 'plain result',
          toolName: 'search_tags',
          ok: true
        }}
      />
    );
    expect(screen.queryByRole('button', { name: 'Format JSON' })).not.toBeInTheDocument();
  });
});
