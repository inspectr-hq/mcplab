import { render, waitFor } from '@testing-library/react';
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
  approveAllScenarioAssistantToolCalls: vi.fn()
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
    warnings: [],
    tools: [],
    pendingToolCalls: [],
    messages: [],
    createdAt: new Date().toISOString(),
    lastTouchedAt: new Date().toISOString()
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
});
