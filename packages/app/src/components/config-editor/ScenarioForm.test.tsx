import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScenarioForm } from './ScenarioForm';
import type { Scenario, AgentConfig, ServerConfig } from '@/types/eval';

const mockSource = {
  discoverToolsForAnalysis: vi.fn().mockResolvedValue({ servers: [] }),
  runScenarioPreview: vi.fn()
};
const mockEnsureOAuthForServers = vi.fn();

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: mockSource
  })
}));

vi.mock('@/lib/oauth-session-utils', () => ({
  ensureOAuthForServers: (...args: unknown[]) => mockEnsureOAuthForServers(...args)
}));

vi.mock('@/components/config-editor/ScenarioAssistantDialog', () => ({
  ScenarioAssistantDialog: () => null
}));

function baseScenario(): Scenario {
  return {
    id: 'scn-1',
    name: 'Scenario 1',
    serverIds: [],
    prompt: 'test prompt',
    evalRules: [],
    extractRules: []
  };
}

describe('ScenarioForm checks editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSource.discoverToolsForAnalysis.mockResolvedValue({ servers: [] });
    mockSource.runScenarioPreview.mockResolvedValue({
      runId: 'preview-1',
      scenarioId: 'scn-1',
      agentName: 'agent-1',
      run: {
        runIndex: 0,
        passed: true,
        toolCalls: [],
        finalAnswer: 'ok',
        conversation: [],
        duration: 10,
        extractedValues: {},
        failureReasons: []
      }
    });
    mockEnsureOAuthForServers.mockResolvedValue(undefined);
  });

  it('loads tools after ensuring OAuth for oauth2 servers', async () => {
    mockSource.discoverToolsForAnalysis.mockResolvedValue({ servers: [{ tools: [] }] });

    const onChange = vi.fn();
    render(
      <ScenarioForm
        scenarios={[{ ...baseScenario(), serverIds: ['oauth-server'] }]}
        agents={[] as AgentConfig[]}
        servers={
          [
            {
              id: 'oauth-server',
              name: 'OAuth Server',
              transport: 'streamable-http',
              url: 'https://example.com/mcp',
              authType: 'oauth2'
            }
          ] as ServerConfig[]
        }
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load tools' }));

    await waitFor(() =>
      expect(mockEnsureOAuthForServers).toHaveBeenCalledWith({
        serverNames: ['oauth-server'],
        source: mockSource
      })
    );
    await waitFor(() =>
      expect(mockSource.discoverToolsForAnalysis).toHaveBeenCalledWith({
        serverNames: ['oauth-server']
      })
    );
  });

  it('adds response_equals checks with literal value', async () => {
    const onChange = vi.fn();

    render(
      <ScenarioForm
        scenarios={[baseScenario()]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getAllByRole('combobox')[1]);
    fireEvent.click(screen.getByText('Text equals'));
    fireEvent.change(screen.getByPlaceholderText('Value'), {
      target: { value: 'success' }
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toEqual([{ type: 'response_equals', value: 'success' }]);
  });

  it('adds ordered tool sequence checks as an ordered list', async () => {
    const onChange = vi.fn();

    render(
      <ScenarioForm
        scenarios={[baseScenario()]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Tool name'), {
      target: { value: 'search' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toContainEqual({
      type: 'tool_sequence',
      sequence: ['search']
    });
  });

  it('adds response_jsonpath checks with optional equals', async () => {
    const onChange = vi.fn();

    render(
      <ScenarioForm
        scenarios={[baseScenario()]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getAllByRole('combobox')[1]);
    fireEvent.click(screen.getByText('JSONPath (optional equals)'));
    fireEvent.change(screen.getByPlaceholderText('JSONPath (e.g. $.status)'), {
      target: { value: '$.status' }
    });
    fireEvent.change(screen.getByPlaceholderText('Equals (optional)'), {
      target: { value: 'active' }
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toEqual([
      { type: 'response_jsonpath', path: '$.status', equals: 'active' }
    ]);
  });

  it('clears agentContext when last agent_check rule is removed', async () => {
    const onChange = vi.fn();
    const scenario: Scenario = {
      ...baseScenario(),
      evalRules: [{ type: 'agent_check', label: 'Range', prompt: 'Check range.' }],
      agentContext: { include_prompt: true, include_tool_sequence: false }
    };

    render(
      <ScenarioForm
        scenarios={[scenario]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove check 1' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toEqual([]);
    expect(updated[0]?.agentContext).toBeUndefined();
  });

  it('preserves agentContext when a non-last agent_check rule is removed', async () => {
    const onChange = vi.fn();
    const scenario: Scenario = {
      ...baseScenario(),
      evalRules: [
        { type: 'agent_check', label: 'Range', prompt: 'Check range.' },
        { type: 'agent_check', label: 'Source', prompt: 'Check source.' }
      ],
      agentContext: { include_prompt: true }
    };

    render(
      <ScenarioForm
        scenarios={[scenario]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove check 1' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toHaveLength(1);
    expect(updated[0]?.agentContext).toEqual({ include_prompt: true });
  });

  it('adds agent checks with label and prompt', async () => {
    const onChange = vi.fn();

    render(
      <ScenarioForm
        scenarios={[baseScenario()]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getAllByRole('combobox')[1]);
    fireEvent.click(screen.getByText('Judge Agent'));
    fireEvent.change(screen.getByPlaceholderText('Prompt name'), {
      target: { value: 'Logical range' }
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Judge prompt. Example: Confirm the answer includes a valid earliest and latest timestamp range, and that neither is 'Not available'."
      ),
      {
        target: { value: 'Confirm the answer includes a valid logical time range.' }
      }
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toEqual([
      {
        type: 'agent_check',
        label: 'Logical range',
        prompt: 'Confirm the answer includes a valid logical time range.'
      }
    ]);
  });

  it('ensures OAuth before running prompt preview', async () => {
    render(
      <ScenarioForm
        scenarios={[{ ...baseScenario(), serverIds: ['oauth-server'] }]}
        agents={
          [
            {
              id: 'agent-1',
              name: 'Agent 1',
              provider: 'openai',
              model: 'gpt-4o-mini',
              temperature: 0,
              maxTokens: 1024
            }
          ] as AgentConfig[]
        }
        servers={
          [
            {
              id: 'oauth-server',
              name: 'OAuth Server',
              transport: 'streamable-http',
              url: 'https://example.com/mcp',
              authType: 'oauth2'
            }
          ] as ServerConfig[]
        }
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run Prompt' }));

    await waitFor(() =>
      expect(mockEnsureOAuthForServers).toHaveBeenCalledWith({
        serverNames: ['oauth-server'],
        source: mockSource
      })
    );
    await waitFor(() => expect(mockSource.runScenarioPreview).toHaveBeenCalled());
  });

  it('includes attachments in prompt preview request', async () => {
    render(
      <ScenarioForm
        scenarios={[
          {
            ...baseScenario(),
            serverIds: ['server-1'],
            attachments: [
              {
                type: 'document',
                media_type: 'text/plain',
                data: 'aGVsbG8=',
                name: 'notes.txt'
              }
            ]
          }
        ]}
        agents={
          [
            {
              id: 'agent-1',
              name: 'Agent 1',
              provider: 'openai',
              model: 'gpt-4o-mini',
              temperature: 0,
              maxTokens: 1024
            }
          ] as AgentConfig[]
        }
        servers={
          [
            {
              id: 'server-1',
              name: 'Server 1',
              transport: 'streamable-http',
              url: 'https://example.com/mcp',
              authType: 'none'
            }
          ] as ServerConfig[]
        }
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run Prompt' }));

    await waitFor(() =>
      expect(mockSource.runScenarioPreview).toHaveBeenCalledWith({
        selectedAgentName: 'agent-1',
        scenario: expect.objectContaining({
          attachments: [
            {
              type: 'document',
              media_type: 'text/plain',
              data: 'aGVsbG8=',
              name: 'notes.txt'
            }
          ]
        })
      })
    );
  });
});
