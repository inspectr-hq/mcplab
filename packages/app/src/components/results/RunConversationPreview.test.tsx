import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RunConversationPreview } from './RunConversationPreview';
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
});
