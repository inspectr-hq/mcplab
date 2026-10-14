import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ResultAssistantPanel,
  type ResultAssistantMessageRenderContext
} from './ResultAssistantPanel';

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

  it('renders an independent approval card for every call in a batch', () => {
    const renderMessage = vi.fn(
      ({ message, linkedPendingToolCall }: ResultAssistantMessageRenderContext) => (
        <div key={message.id}>
          <span>{`Tool call ${linkedPendingToolCall?.tool}`}</span>
          <span>
            {linkedPendingToolCall?.status === 'pending' ? 'Needs approval' : 'Completed'}
          </span>
        </div>
      )
    );
    render(
      <ResultAssistantPanel
        title="MCP Lab Assistant"
        description="Analyze results."
        expanded={false}
        onToggleExpanded={vi.fn()}
        onHide={vi.fn()}
        messages={[
          {
            id: 'msg-batch',
            role: 'assistant',
            text: 'I need both tools.',
            createdAt: '2026-04-26T10:00:00.000Z',
            pendingToolCallIds: ['call-a', 'call-b']
          }
        ]}
        pendingToolCalls={[
          {
            id: 'call-a',
            server: 'mcplab',
            tool: 'read_a',
            publicToolName: 'read_a',
            arguments: {},
            status: 'pending',
            createdAt: '2026-04-26T10:00:00.000Z'
          },
          {
            id: 'call-b',
            server: 'mcplab',
            tool: 'read_b',
            publicToolName: 'read_b',
            arguments: {},
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
        onApproveToolCall={vi.fn()}
        onDenyToolCall={vi.fn()}
        renderMessage={renderMessage}
        chatEndRef={createRef<HTMLDivElement>()}
        inputRef={createRef<HTMLTextAreaElement>()}
      />
    );
    expect(screen.getByText('Tool call read_a')).toBeInTheDocument();
    expect(screen.getByText('Tool call read_b')).toBeInTheDocument();
    expect(screen.getAllByText('Needs approval')).toHaveLength(2);
    expect(renderMessage).toHaveBeenCalledTimes(2);
    expect(renderMessage.mock.calls.map(([context]) => context.linkedPendingToolCall?.id)).toEqual([
      'call-a',
      'call-b'
    ]);
  });
});
