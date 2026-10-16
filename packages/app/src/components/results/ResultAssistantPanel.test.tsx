import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultAssistantPanel } from './ResultAssistantPanel';
import { useResultAssistant } from '@/hooks/use-result-assistant';
import type { EvalDataSource, ResultAssistantSessionView } from '@/lib/data-sources/types';

function makeSession(
  overrides: Partial<ResultAssistantSessionView> = {}
): ResultAssistantSessionView {
  return {
    revision: 0,
    id: 'session-1',
    scope: 'run',
    runId: 'run-1',
    createdAt: '2026-10-16T10:00:00.000Z',
    updatedAt: '2026-10-16T10:00:00.000Z',
    selectedAssistantAgentName: 'assistant-1',
    model: 'gpt-4o-mini',
    provider: 'openai',
    messages: [],
    pendingToolCalls: [],
    ...overrides
  };
}

describe('ResultAssistantPanel', () => {
  it('renders SSE text while the message POST is still pending', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    });
    let onEvent: ((event: unknown) => void) | undefined;
    const sendResultAssistantMessageMock = vi.fn(
      (_sessionId: string, _message: string, _signal?: AbortSignal, _turnId?: string) =>
        new Promise<never>(() => undefined)
    );
    const source = {
      createResultAssistantSession: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        session: makeSession()
      }),
      sendResultAssistantMessage: sendResultAssistantMessageMock,
      closeResultAssistantSession: vi.fn().mockResolvedValue(undefined),
      subscribeResultAssistantSessionEvents: vi.fn(
        (_sessionId: string, callback: typeof onEvent) => {
          onEvent = callback;
          return () => undefined;
        }
      )
    } as unknown as EvalDataSource;

    function AssistantPanelHarness() {
      const assistant = useResultAssistant({
        source,
        open: true,
        scope: 'run',
        runId: 'run-1'
      });
      return (
        <ResultAssistantPanel
          title="Assistant"
          description="Test streaming"
          expanded={false}
          onToggleExpanded={vi.fn()}
          onHide={vi.fn()}
          messages={assistant.assistantMessages}
          pendingToolCalls={assistant.assistantPendingToolCalls}
          loading={assistant.assistantLoading}
          input={assistant.assistantInput}
          onInputChange={assistant.setAssistantInput}
          onSend={() => void assistant.askAssistant()}
          inputPlaceholder="Ask the assistant"
          snippets={[]}
          onSnippetSelect={vi.fn()}
          inputRef={assistant.assistantInputRef}
        />
      );
    }

    render(<AssistantPanelHarness />);
    fireEvent.change(screen.getByPlaceholderText('Ask the assistant'), {
      target: { value: 'Explain this result' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send assistant message' }));
    await waitFor(() => expect(sendResultAssistantMessageMock).toHaveBeenCalledTimes(1));

    const turnId = sendResultAssistantMessageMock.mock.calls[0]?.[3];
    act(() =>
      onEvent?.({
        type: 'turn_started',
        ts: '2026-10-16T10:00:01.000Z',
        payload: {
          sessionId: 'session-1',
          session: makeSession({
            revision: 1,
            activeTurnId: turnId,
            messages: [
              {
                id: turnId,
                role: 'user',
                text: 'Explain this result',
                createdAt: '2026-10-16T10:00:01.000Z'
              }
            ]
          })
        }
      })
    );
    act(() =>
      onEvent?.({
        type: 'assistant_message_delta',
        ts: '2026-10-16T10:00:02.000Z',
        payload: {
          sessionId: 'session-1',
          turnId,
          messageId: 'assistant-1',
          revision: 2,
          offset: 0,
          delta: 'Streaming answer',
          createdAt: '2026-10-16T10:00:02.000Z'
        }
      })
    );

    expect(await screen.findByText('Streaming answer')).toBeInTheDocument();
    expect(sendResultAssistantMessageMock).toHaveBeenCalledTimes(1);
  });

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
        inputRef={createRef<HTMLTextAreaElement>()}
      />
    );

    expect(screen.getByText('Read run artifact')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(onDeny).toHaveBeenCalledWith('call-1');
    expect(onApprove).toHaveBeenCalledWith('call-1');
  });

  it('renders an independent approval card for every call in a batch', () => {
    const onApprove = vi.fn();
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
            status: 'approved',
            resultPreview: '{"ok":true}',
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
        onDenyToolCall={vi.fn()}
        inputRef={createRef<HTMLTextAreaElement>()}
      />
    );
    expect(screen.getByText('I need both tools.')).toBeInTheDocument();
    expect(screen.getByText('Read a')).toBeInTheDocument();
    expect(screen.getByText('Read b')).toBeInTheDocument();
    expect(screen.getByText('Needs approval')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith('call-a');
  });

  it('renders page actions in assistant messages through the footer slot', () => {
    render(
      <ResultAssistantPanel
        title="MCP Lab Assistant"
        description="Analyze results."
        expanded={false}
        onToggleExpanded={vi.fn()}
        onHide={vi.fn()}
        messages={[
          {
            id: 'u',
            role: 'user',
            text: 'Why did it fail?',
            createdAt: '2026-04-26T10:00:00.000Z'
          },
          { id: 'a', role: 'assistant', text: 'Because.', createdAt: '2026-04-26T10:00:01.000Z' }
        ]}
        pendingToolCalls={[]}
        loading={false}
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        inputPlaceholder="Ask..."
        snippets={[]}
        onSnippetSelect={vi.fn()}
        inputRef={createRef<HTMLTextAreaElement>()}
        renderMessageFooter={(message) =>
          message.role === 'assistant' ? <button type="button">Write report</button> : null
        }
      />
    );
    expect(screen.getAllByRole('button', { name: 'Write report' })).toHaveLength(1);
  });

  it('shows the expired-session notice and disables decisions', () => {
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
            text: 'Writing.',
            createdAt: '2026-04-26T10:00:00.000Z',
            pendingToolCallId: 'call-1'
          }
        ]}
        pendingToolCalls={[
          {
            id: 'call-1',
            server: 'mcplab',
            tool: 'write',
            publicToolName: 'write',
            arguments: {},
            status: 'pending',
            createdAt: '2026-04-26T10:00:00.000Z'
          }
        ]}
        loading={false}
        expired
        input=""
        onInputChange={vi.fn()}
        onSend={vi.fn()}
        inputPlaceholder="Ask..."
        snippets={[]}
        onSnippetSelect={vi.fn()}
        inputRef={createRef<HTMLTextAreaElement>()}
      />
    );
    expect(screen.getByText(/session has expired/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });
});
