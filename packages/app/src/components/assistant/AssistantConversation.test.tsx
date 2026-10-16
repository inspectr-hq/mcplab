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

  it('shows calls that ran without asking as activity and the rest as approval cards', () => {
    render(
      <AssistantConversation
        messages={[toolRequest(['auto', 'ask'])]}
        toolCalls={[
          call({
            id: 'auto',
            tool: 'read_mcp_resource',
            arguments: { uri: 'docs://guide' },
            status: 'approved',
            resultPreview: '{}',
            requiresApproval: false
          }),
          call({ id: 'ask', requiresApproval: true })
        ]}
        busy={false}
        onApprove={vi.fn()}
        composer={composer}
      />
    );
    expect(screen.getByText('docs://guide')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Approval needed: Write report' })).toBeVisible();
  });

  it('shows streaming reasoning instead of the typing indicator', () => {
    render(
      <AssistantConversation
        messages={[
          {
            id: 'm',
            role: 'assistant' as const,
            text: '',
            createdAt: '2026-10-16T10:00:00.000Z',
            reasoning: { text: 'Comparing runs' }
          }
        ]}
        toolCalls={[]}
        busy
        composer={composer}
      />
    );
    expect(screen.getByText('Comparing runs')).toBeVisible();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });

  it('shows a tool result on its call, not again as a separate message', () => {
    render(
      <AssistantConversation
        messages={[
          toolRequest(['auto']),
          {
            id: 'msg-tool',
            role: 'tool' as const,
            text: '{"hits":10}',
            createdAt: '2026-10-16T10:00:01.000Z'
          }
        ]}
        toolCalls={[
          call({
            id: 'auto',
            tool: 'search_results',
            arguments: { query: 'failed' },
            status: 'approved',
            resultPreview: '{"hits":10}',
            requiresApproval: false
          })
        ]}
        busy={false}
        composer={composer}
      />
    );
    expect(screen.getByText('failed')).toBeVisible();
    expect(screen.queryByText('{"hits":10}')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Search results/ }));
    expect(screen.getAllByText('{"hits":10}')).toHaveLength(1);
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
    expect(screen.getByText('Write report')).toBeInTheDocument();
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

  it('follows growing reasoning, unless the user scrolled up', () => {
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    const thinking = (text: string) => [
      {
        id: 'm',
        role: 'assistant' as const,
        text: '',
        createdAt: '2026-10-16T10:00:00.000Z',
        reasoning: { text }
      }
    ];
    const view = (text: string) => (
      <AssistantConversation messages={thinking(text)} toolCalls={[]} busy composer={composer} />
    );
    const { container, rerender } = render(view('Checking'));
    scrollIntoView.mockClear();
    rerender(view('Checking the run'));
    expect(scrollIntoView).toHaveBeenCalled();

    const scroller = container.querySelector('.overflow-y-auto') as HTMLDivElement;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: 100 }
    });
    fireEvent.scroll(scroller);
    scrollIntoView.mockClear();
    rerender(view('Checking the run and its checks'));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
