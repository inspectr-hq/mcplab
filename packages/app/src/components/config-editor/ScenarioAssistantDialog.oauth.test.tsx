import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScenarioAssistantDialog } from './ScenarioAssistantDialog';
import type { AgentConfig, Scenario, ServerConfig } from '@/types/eval';
import type { ScenarioAssistantSessionView } from '@/lib/data-sources/types';

const mockSource = {
  createScenarioAssistantSession: vi.fn(),
  closeScenarioAssistantSession: vi.fn().mockResolvedValue(undefined),
  sendScenarioAssistantMessage: vi.fn(),
  approveScenarioAssistantToolCall: vi.fn(),
  denyScenarioAssistantToolCall: vi.fn(),
  approveAllScenarioAssistantToolCalls: vi.fn(),
  subscribeScenarioAssistantSessionEvents: vi.fn()
};

const mockEnsureOAuthForServers = vi.fn();
const mockToast = vi.fn();

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({ source: mockSource })
}));

vi.mock('@/lib/oauth-session-utils', () => ({
  ensureOAuthForServers: (...args: unknown[]) => mockEnsureOAuthForServers(...args)
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args)
}));

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'scenario-1',
    name: 'Scenario',
    serverIds: ['oauth-server'],
    prompt: 'Run flow',
    evalRules: [],
    extractRules: [],
    ...overrides
  };
}

const agents: AgentConfig[] = [
  {
    id: 'assistant-1',
    name: 'Assistant',
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0,
    maxTokens: 1024
  }
];

const servers: ServerConfig[] = [
  {
    id: 'oauth-server',
    name: 'OAuth Server',
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    authType: 'oauth2'
  }
];

function makeAssistantSession(): ScenarioAssistantSessionView {
  return {
    id: 'sas-1',
    selectedAssistantAgentName: 'assistant-1',
    model: 'gpt-4o-mini',
    provider: 'openai',
    warnings: [],
    toolsLoaded: 1,
    toolServers: ['oauth-server'],
    pendingToolCalls: [],
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

describe('ScenarioAssistantDialog OAuth startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockImplementation(() => null);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn()
    });
    mockSource.createScenarioAssistantSession.mockResolvedValue({
      sessionId: 'sas-1',
      session: makeAssistantSession()
    });
    mockEnsureOAuthForServers.mockResolvedValue(undefined);
  });

  it('runs OAuth bootstrap before creating scenario assistant session', async () => {
    render(
      <ScenarioAssistantDialog
        open
        onOpenChange={vi.fn()}
        scenario={makeScenario()}
        agents={agents}
        servers={servers}
        onApplyPatch={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(mockEnsureOAuthForServers).toHaveBeenCalledWith({
        serverNames: ['oauth-server'],
        source: mockSource
      })
    );
    await waitFor(() => expect(mockSource.createScenarioAssistantSession).toHaveBeenCalled());

    expect(mockSource.createScenarioAssistantSession).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: 'scenario-1' })
    );
  });

  it('reuses a completed OAuth runtime session on reopen', async () => {
    const { rerender } = render(
      <ScenarioAssistantDialog
        open
        onOpenChange={vi.fn()}
        scenario={makeScenario()}
        agents={agents}
        servers={servers}
        onApplyPatch={vi.fn()}
      />
    );

    await waitFor(() => expect(mockSource.createScenarioAssistantSession).toHaveBeenCalledTimes(1));

    rerender(
      <ScenarioAssistantDialog
        open={false}
        onOpenChange={vi.fn()}
        scenario={makeScenario()}
        agents={agents}
        servers={servers}
        onApplyPatch={vi.fn()}
      />
    );

    await waitFor(() => expect(mockSource.closeScenarioAssistantSession).toHaveBeenCalled());

    rerender(
      <ScenarioAssistantDialog
        open
        onOpenChange={vi.fn()}
        scenario={makeScenario()}
        agents={agents}
        servers={servers}
        onApplyPatch={vi.fn()}
      />
    );

    await waitFor(() => expect(mockSource.createScenarioAssistantSession).toHaveBeenCalledTimes(2));
    expect(mockEnsureOAuthForServers).toHaveBeenCalledTimes(2);
  });

  it('does not create scenario assistant session when OAuth bootstrap fails', async () => {
    mockEnsureOAuthForServers.mockRejectedValue(new Error('OAuth timed out'));

    render(
      <ScenarioAssistantDialog
        open
        onOpenChange={vi.fn()}
        scenario={makeScenario()}
        agents={agents}
        servers={servers}
        onApplyPatch={vi.fn()}
      />
    );

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockSource.createScenarioAssistantSession).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not start Scenario Assistant',
        variant: 'destructive'
      })
    );
  });

  it('only starts OAuth runtime for selected oauth2 servers in mixed scenarios', async () => {
    const mixedServers: ServerConfig[] = [
      ...servers,
      {
        id: 'bearer-server',
        name: 'Bearer Server',
        transport: 'streamable-http',
        url: 'https://example.com/bearer',
        authType: 'bearer',
        authValue: 'token'
      }
    ];

    render(
      <ScenarioAssistantDialog
        open
        onOpenChange={vi.fn()}
        scenario={makeScenario({ serverIds: ['oauth-server', 'bearer-server'] })}
        agents={agents}
        servers={mixedServers}
        onApplyPatch={vi.fn()}
      />
    );

    await waitFor(() => expect(mockSource.createScenarioAssistantSession).toHaveBeenCalled());
    expect(mockEnsureOAuthForServers).toHaveBeenCalledWith(
      expect.objectContaining({
        serverNames: ['oauth-server']
      })
    );
  });

  it('cancels a pending scenario assistant prompt locally', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockSource.sendScenarioAssistantMessage.mockImplementation(
      async (_sessionId: string, _message: string, signal?: AbortSignal) => {
        capturedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        });
        return {
          session: makeAssistantSession(),
          response: {
            type: 'assistant_message',
            text: 'aborted'
          }
        };
      }
    );

    render(
      <ScenarioAssistantDialog
        open
        onOpenChange={vi.fn()}
        scenario={makeScenario()}
        agents={agents}
        servers={servers}
        onApplyPatch={vi.fn()}
      />
    );

    await waitFor(() => expect(mockSource.createScenarioAssistantSession).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Assistant is loading' })).not.toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Send assistant message' })).toBeInTheDocument();

    const input = screen.getByPlaceholderText(
      'Get assistance with creating or refining this scenario ...'
    );
    fireEvent.change(input, { target: { value: 'Draft a better scenario' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send assistant message' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel assistant message' })).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel assistant message' }));

    await waitFor(() => expect(capturedSignal?.aborted).toBe(true));
    await waitFor(() =>
      expect(screen.getByDisplayValue('Draft a better scenario')).toBeInTheDocument()
    );
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('renders structured suggestions and applies patches', async () => {
    const onApplyPatch = vi.fn();
    mockSource.createScenarioAssistantSession.mockResolvedValue({
      sessionId: 'sas-1',
      session: {
        ...makeAssistantSession(),
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            text: 'I suggest tightening the prompt.',
            createdAt: new Date().toISOString(),
            suggestions: {
              prompt: {
                replacement: 'Return exactly the asset tags.',
                rationale: 'This is more deterministic.'
              }
            }
          }
        ]
      }
    });

    render(
      <ScenarioAssistantDialog
        open
        onOpenChange={vi.fn()}
        scenario={makeScenario()}
        agents={agents}
        servers={servers}
        onApplyPatch={onApplyPatch}
      />
    );

    await screen.findByText('Structured Suggestions');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApplyPatch).toHaveBeenCalledWith({ prompt: 'Return exactly the asset tags.' });
  });

  it('merges live assistant session updates from SSE events', async () => {
    let onScenarioEvent:
      | ((event: { payload: { session: ScenarioAssistantSessionView } }) => void)
      | undefined;
    mockSource.subscribeScenarioAssistantSessionEvents.mockImplementation(
      (_sessionId: string, onEvent: typeof onScenarioEvent) => {
        onScenarioEvent = onEvent;
        return () => undefined;
      }
    );
    mockSource.createScenarioAssistantSession.mockResolvedValue({
      sessionId: 'sas-1',
      session: makeAssistantSession()
    });

    render(
      <ScenarioAssistantDialog
        open
        onOpenChange={vi.fn()}
        scenario={makeScenario()}
        agents={agents}
        servers={servers}
        onApplyPatch={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(mockSource.subscribeScenarioAssistantSessionEvents).toHaveBeenCalled()
    );
    await act(async () => {
      onScenarioEvent?.({
        type: 'assistant_message_completed',
        ts: new Date().toISOString(),
        payload: {
          sessionId: 'sas-1',
          session: {
            ...makeAssistantSession(),
            messages: [
              {
                id: 'msg-1',
                role: 'assistant',
                text: 'Live update from SSE',
                createdAt: new Date().toISOString()
              }
            ]
          }
        }
      });
    });

    expect(await screen.findByText('Live update from SSE')).toBeInTheDocument();
  });

  it('approves all pending scenario assistant tool calls', async () => {
    mockSource.approveAllScenarioAssistantToolCalls.mockResolvedValue({
      session: makeAssistantSession(),
      response: { type: 'tool_call_resolved', text: 'Approved' }
    });
    mockSource.createScenarioAssistantSession.mockResolvedValue({
      sessionId: 'sas-1',
      session: {
        ...makeAssistantSession(),
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            text: 'I need to inspect two tools.',
            createdAt: new Date().toISOString(),
            pendingToolCallIds: ['call-1', 'call-2']
          }
        ],
        pendingToolCalls: [
          {
            id: 'call-1',
            server: 'oauth-server',
            tool: 'search_assets',
            publicToolName: 'oauth-server__search_assets',
            arguments: { q: 'assets' },
            status: 'pending',
            createdAt: new Date().toISOString()
          },
          {
            id: 'call-2',
            server: 'oauth-server',
            tool: 'list_tags',
            publicToolName: 'oauth-server__list_tags',
            arguments: {},
            status: 'pending',
            createdAt: new Date().toISOString()
          }
        ]
      }
    });

    render(
      <ScenarioAssistantDialog
        open
        onOpenChange={vi.fn()}
        scenario={makeScenario()}
        agents={agents}
        servers={servers}
        onApplyPatch={vi.fn()}
      />
    );

    await screen.findByRole('button', { name: 'Approve All (2)' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve All (2)' })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve All (2)' }));

    await waitFor(() =>
      expect(mockSource.approveAllScenarioAssistantToolCalls).toHaveBeenCalledWith('sas-1')
    );
  });

  it('minimizes an active session without discarding it', async () => {
    function Wrapper() {
      const [open, setOpen] = useState(true);
      return (
        <ScenarioAssistantDialog
          open={open}
          onOpenChange={setOpen}
          scenario={makeScenario()}
          agents={agents}
          servers={servers}
          onApplyPatch={vi.fn()}
        />
      );
    }

    render(<Wrapper />);

    await screen.findByLabelText('Minimize assistant');
    const assistantInput = screen.getByPlaceholderText(
      'Get assistance with creating or refining this scenario ...'
    );
    assistantInput.focus();
    expect(document.activeElement).toBe(assistantInput);
    fireEvent.click(screen.getByLabelText('Minimize assistant'));

    expect(mockSource.closeScenarioAssistantSession).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText('Get assistance with creating or refining this scenario ...')
      ).not.toBeInTheDocument()
    );
    expect(document.activeElement).not.toBe(assistantInput);

    expect(screen.getByText('Scenario Assistant (session active)')).toBeInTheDocument();
  });
});
