import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantConversation } from './AssistantConversation';
import type { AssistantToolCall } from './AssistantChat';

const call = (overrides: Partial<AssistantToolCall> = {}): AssistantToolCall => ({
  id: 'call-1',
  server: 's',
  tool: 'write_report',
  publicToolName: 's__write_report',
  arguments: { path: 'a.md' },
  status: 'pending',
  createdAt: '2026-10-16T10:00:00.000Z',
  ...overrides
});

const composer = {
  input: '',
  onInputChange: vi.fn(),
  onSend: vi.fn(),
  inputPlaceholder: 'Ask...',
  snippets: [],
  snippetsLabel: 'Snippets',
  onSnippetSelect: vi.fn(),
  inputRef: createRef<HTMLTextAreaElement>()
};

function toolRequest(callIds: string[]) {
  return {
    id: 'msg-1',
    role: 'assistant' as const,
    text: 'I need tools.',
    createdAt: '2026-10-16T10:00:00.000Z',
    pendingToolCallIds: callIds
  };
}

describe('AssistantConversation', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn()
    });
  });

  it('approves with edited arguments only after they parse as a JSON object', () => {
    const onApprove = vi.fn();
    render(
      <AssistantConversation
        messages={[toolRequest(['call-1'])]}
        toolCalls={[call()]}
        busy={false}
        onApprove={onApprove}
        onDeny={vi.fn()}
        composer={composer}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit arguments' }));
    const editor = screen.getByLabelText('Edit tool call arguments');
    fireEvent.change(editor, { target: { value: '{"path":' } });
    expect(screen.getByText('Arguments must be valid JSON.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve with edits' })).toBeDisabled();
    fireEvent.change(editor, { target: { value: '["not", "an", "object"]' } });
    expect(screen.getByText('Arguments must be a JSON object.')).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: '{"path":"b.md"}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve with edits' }));
    expect(onApprove).toHaveBeenCalledWith('call-1', { path: 'b.md' });
  });

  it('approves unedited calls with the call ID only', () => {
    const onApprove = vi.fn();
    render(
      <AssistantConversation
        messages={[toolRequest(['call-1'])]}
        toolCalls={[call()]}
        busy={false}
        onApprove={onApprove}
        composer={composer}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith('call-1');
  });

  it('offers approve-all only when supported and more than one call is pending', () => {
    const calls = [call(), call({ id: 'call-2', tool: 'read_report' })];
    const { rerender } = render(
      <AssistantConversation
        messages={[toolRequest(['call-1', 'call-2'])]}
        toolCalls={calls}
        busy={false}
        onApprove={vi.fn()}
        composer={composer}
      />
    );
    expect(screen.queryByRole('button', { name: /Approve All/ })).not.toBeInTheDocument();
    const onApproveAll = vi.fn();
    rerender(
      <AssistantConversation
        messages={[toolRequest(['call-1', 'call-2'])]}
        toolCalls={calls}
        busy={false}
        onApprove={vi.fn()}
        onApproveAll={onApproveAll}
        composer={composer}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve All (2)' }));
    expect(onApproveAll).toHaveBeenCalledOnce();
  });

  it('shows settled outcomes from the status mapper instead of treating approved as done', () => {
    render(
      <AssistantConversation
        messages={[toolRequest(['call-1', 'call-2', 'call-3'])]}
        toolCalls={[
          call({ status: 'approved' }),
          call({ id: 'call-2', status: 'error', error: 'Tool call cancelled before execution' }),
          call({
            id: 'call-3',
            status: 'denied',
            error: 'Tool call skipped because a new user message superseded the turn'
          })
        ]}
        busy={false}
        composer={composer}
      />
    );
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it('lists pending calls that no message references', () => {
    render(
      <AssistantConversation
        messages={[]}
        toolCalls={[call({ id: 'orphan' })]}
        busy={false}
        onApprove={vi.fn()}
        composer={composer}
      />
    );
    expect(screen.getByText('Pending actions')).toBeInTheDocument();
    expect(screen.getByText('Tool call write report')).toBeInTheDocument();
  });

  it('stops following new output while the user reads earlier messages', () => {
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    const message = (id: string, text: string) => ({
      id,
      role: 'assistant' as const,
      text,
      createdAt: '2026-10-16T10:00:00.000Z'
    });
    const { container, rerender } = render(
      <AssistantConversation
        messages={[message('a', 'first')]}
        toolCalls={[]}
        busy={false}
        composer={composer}
      />
    );
    const scroller = container.querySelector('.overflow-y-auto') as HTMLDivElement;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: 100 }
    });
    fireEvent.scroll(scroller);
    scrollIntoView.mockClear();
    rerender(
      <AssistantConversation
        messages={[message('a', 'first'), message('b', 'second')]}
        toolCalls={[]}
        busy={false}
        composer={composer}
      />
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    scroller.scrollTop = 790;
    fireEvent.scroll(scroller);
    rerender(
      <AssistantConversation
        messages={[message('a', 'first'), message('b', 'second'), message('c', 'third')]}
        toolCalls={[]}
        busy={false}
        composer={composer}
      />
    );
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
