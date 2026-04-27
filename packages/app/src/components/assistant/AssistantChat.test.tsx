import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AssistantComposer,
  AssistantMessageRow,
  AssistantToolCallCard,
  type AssistantSnippet
} from './AssistantChat';

describe('AssistantChat shared primitives', () => {
  it('renders a shared composer with snippets and send behavior', () => {
    const snippets: AssistantSnippet[] = [
      {
        label: 'Suggest Checks',
        description: 'Propose stronger checks.',
        prompt: 'Suggest checks'
      }
    ];
    const onInputChange = vi.fn();
    const onSnippetSelect = vi.fn();
    const onSend = vi.fn();

    render(
      <AssistantComposer
        input="hello"
        onInputChange={onInputChange}
        onSend={onSend}
        inputPlaceholder="Ask the assistant..."
        snippets={snippets}
        snippetsLabel="Assistant Snippets"
        onSnippetSelect={onSnippetSelect}
      />
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Snippets' }), { key: 'Enter' });
    fireEvent.click(screen.getByText('Suggest Checks'));
    expect(onSnippetSelect).toHaveBeenCalledWith('Suggest checks');

    fireEvent.click(screen.getByRole('button', { name: 'Send assistant message' }));
    expect(onSend).toHaveBeenCalled();
  });

  it('renders assistant messages and pending tool call actions consistently', () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();

    render(
      <>
        <AssistantMessageRow
          message={{
            id: 'msg-1',
            role: 'assistant',
            text: 'I can help with that.',
            createdAt: '2026-04-26T10:00:00.000Z'
          }}
        />
        <AssistantToolCallCard
          call={{
            id: 'call-1',
            server: 'mcplab',
            tool: 'read_results',
            publicToolName: 'mcplab__read_results',
            arguments: { runId: 'run-1' },
            status: 'pending',
            createdAt: '2026-04-26T10:00:00.000Z'
          }}
          onApprove={onApprove}
          onDeny={onDeny}
        />
      </>
    );

    expect(screen.getByText('I can help with that.')).toBeInTheDocument();
    expect(screen.getByText('Tool call read_results')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDeny).toHaveBeenCalledWith('call-1');
    expect(onApprove).toHaveBeenCalledWith('call-1');
  });
});
