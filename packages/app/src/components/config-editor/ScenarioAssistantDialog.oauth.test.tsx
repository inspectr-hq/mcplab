import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScenarioAssistantDialog } from './ScenarioAssistantDialog';
import type { AgentConfig, Scenario, ServerConfig } from '@/types/eval';

const mockSource = {
  createScenarioAssistantSession: vi.fn(),
  closeScenarioAssistantSession: vi.fn().mockResolvedValue(undefined),
  getOAuthRuntimeSession: vi.fn(),
  createOAuthRuntimeSession: vi.fn(),
  getOAuthRuntimeSessionToken: vi.fn(),
  sendScenarioAssistantMessage: vi.fn(),
  approveScenarioAssistantToolCall: vi.fn(),
  denyScenarioAssistantToolCall: vi.fn(),
  approveAllScenarioAssistantToolCalls: vi.fn()
};

const mockWaitForOAuthRuntimeSession = vi.fn();
const mockToast = vi.fn();

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({ source: mockSource })
}));

vi.mock('@/lib/oauth-runtime-utils', () => ({
  waitForOAuthRuntimeSession: (...args: unknown[]) => mockWaitForOAuthRuntimeSession(...args)
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

function makeAssistantSession() {
  return {
    id: 'sas-1',
    selectedAssistantAgentName: 'assistant-1',
    warnings: [],
    tools: [],
    pendingToolCalls: [],
    messages: [],
    createdAt: new Date().toISOString(),
    lastTouchedAt: new Date().toISOString()
  } as any;
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
    mockSource.getOAuthRuntimeSession.mockRejectedValue(new Error('missing session'));
    mockSource.createOAuthRuntimeSession.mockResolvedValue({
      session: {
        id: 'oauthrt-1',
        authorizationUrl: 'https://auth.example.com',
        authorizeLaunchUrl: 'https://auth.example.com',
        status: 'waiting_for_user',
        hasAccessToken: false
      }
    });
    mockWaitForOAuthRuntimeSession.mockResolvedValue(undefined);
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

    await waitFor(() => expect(mockSource.createOAuthRuntimeSession).toHaveBeenCalledWith({ serverName: 'oauth-server' }));
    await waitFor(() => expect(mockWaitForOAuthRuntimeSession).toHaveBeenCalled());
    await waitFor(() => expect(mockSource.createScenarioAssistantSession).toHaveBeenCalled());

    expect(mockSource.createScenarioAssistantSession).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthRuntimeSessions: { 'oauth-server': 'oauthrt-1' }
      })
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

    mockSource.getOAuthRuntimeSession.mockResolvedValue({
      session: { status: 'completed', hasAccessToken: true }
    });

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
    expect(mockSource.createOAuthRuntimeSession).toHaveBeenCalledTimes(1);
    expect(mockSource.createScenarioAssistantSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ oauthRuntimeSessions: { 'oauth-server': 'oauthrt-1' } })
    );
  });

  it('does not create scenario assistant session when OAuth bootstrap fails', async () => {
    mockWaitForOAuthRuntimeSession.mockRejectedValue(new Error('OAuth timed out'));

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
    expect(mockSource.createOAuthRuntimeSession).toHaveBeenCalledTimes(1);
    expect(mockSource.createOAuthRuntimeSession).toHaveBeenCalledWith({ serverName: 'oauth-server' });
    expect(mockSource.createScenarioAssistantSession).toHaveBeenCalledWith(
      expect.objectContaining({ oauthRuntimeSessions: { 'oauth-server': 'oauthrt-1' } })
    );
  });
});
