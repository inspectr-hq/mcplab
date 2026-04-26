import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultAssistantPanel } from './ResultAssistantPanel';

describe('ResultAssistantPanel', () => {
  it('renders pending tool call approval actions', () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();

    render(
      <ResultAssistantPanel
        title="MCP Lab Assistant"
        description="Analyze results."
        expanded={false}
        onToggleExpanded={vi.fn()}
        onHide={vi.fn()}
        messages={[
          {
            id: 'msg-1',
            role: 'assistant',
            text: "I need to call 'read results'.",
            createdAt: '2026-04-26T10:00:00.000Z',
            pendingToolCallId: 'call-1'
          }
        ]}
        pendingToolCalls={[
          {
            id: 'call-1',
            server: 'mcplab',
            tool: 'mcplab_read_run_artifact',
            publicToolName: 'mcplab__mcplab_read_run_artifact',
            arguments: { runId: 'run-1' },
            status: 'pending',
            createdAt: '2026-04-26T10:00:00.000Z'
          }
        ]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        inputPlaceholder="Ask..."
        snippets={[]}
        onSnippetSelect={vi.fn()}
        onApproveToolCall={onApprove}
        onDenyToolCall={onDeny}
        chatEndRef={createRef<HTMLDivElement>()}
        inputRef={createRef<HTMLTextAreaElement>()}
      />
    );

    expect(screen.getByText('Tool call mcplab_read_run_artifact')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(onDeny).toHaveBeenCalledWith('call-1');
    expect(onApprove).toHaveBeenCalledWith('call-1');
  });
});
