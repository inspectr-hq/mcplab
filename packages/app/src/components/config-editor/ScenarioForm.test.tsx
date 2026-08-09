import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScenarioForm } from './ScenarioForm';
import type { Scenario, AgentConfig, ServerConfig } from '@/types/eval';
import { invokeGlobalCopilotAction } from '@/lib/global-copilot-actions';

const mockSource = {
  discoverToolsForAnalysis: vi.fn().mockResolvedValue({ servers: [] }),
  runScenarioPreview: vi.fn()
};
const mockEnsureOAuthForServers = vi.fn();
let mockScenarioAssistantDialogProps: Record<string, unknown> | null = null;

vi.mock('@/contexts/DataSourceContext', () => ({
  useDataSource: () => ({
    source: mockSource
  })
}));

vi.mock('@/lib/oauth-session-utils', () => ({
  ensureOAuthForServers: (...args: unknown[]) => mockEnsureOAuthForServers(...args)
}));

vi.mock('@/components/config-editor/ScenarioAssistantDialog', () => ({
  ScenarioAssistantDialog: (props: Record<string, unknown>) => {
    mockScenarioAssistantDialogProps = props;
    return null;
  }
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
    mockScenarioAssistantDialogProps = null;
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

  it('applies a validated Copilot scenario patch through the existing change handler', async () => {
    const scenario = baseScenario();
    const onChange = vi.fn();
    render(<ScenarioForm scenarios={[scenario]} agents={[]} servers={[]} onChange={onChange} />);

    await invokeGlobalCopilotAction('apply_scenario_patch', {
      scenarioId: scenario.id,
      prompt: 'Updated prompt',
      evalRules: [{ type: 'response_contains', value: 'hello' }]
    });

    expect(onChange).toHaveBeenCalledWith([
      {
        ...scenario,
        prompt: 'Updated prompt',
        evalRules: [{ type: 'response_contains', value: 'hello' }]
      }
    ]);
  });

  it('rejects malformed Copilot scenario rules before changing editor state', async () => {
    const onChange = vi.fn();
    render(<ScenarioForm scenarios={[baseScenario()]} agents={[]} servers={[]} onChange={onChange} />);

    await expect(
      invokeGlobalCopilotAction('apply_scenario_patch', {
        scenarioId: 'scn-1',
        evalRules: [{ type: 'not-a-rule' }]
      })
    ).rejects.toThrow('unsupported rule type');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('normalizes friendly Copilot rule aliases to the stored eval-rule schema', async () => {
    const scenario = baseScenario();
    const onChange = vi.fn();
    render(<ScenarioForm scenarios={[scenario]} agents={[]} servers={[]} onChange={onChange} />);

    await invokeGlobalCopilotAction('apply_scenario_patch', {
      scenarioId: scenario.id,
      evalRules: [
        { type: 'required_tool', tool: 'mcplab_list_library' },
        { type: 'response_regex', pattern: '\\d{4}-\\d{2}-\\d{2}' },
        { type: 'tool_sequence', sequence: ['mcplab_list_library'] }
      ]
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        evalRules: [
          { type: 'required_tool', value: 'mcplab_list_library' },
          { type: 'response_regex', value: '\\d{4}-\\d{2}-\\d{2}' },
          { type: 'tool_sequence', sequence: ['mcplab_list_library'] }
        ]
      })
    ]);
  });

  it('publishes available preview agents in Copilot scenario context', async () => {
    const { globalCopilotPageContext } = await import('@/lib/global-copilot-page-context');
    render(
      <ScenarioForm
        scenarios={[baseScenario()]}
        agents={[{ id: 'agent-1', name: 'Agent 1' } as AgentConfig]}
        servers={[]}
        defaultAssistantAgentName="agent-1"
        onChange={vi.fn()}
      />
    );

    expect(globalCopilotPageContext().scenarioEditor).toMatchObject({
      agents: [{ id: 'agent-1', name: 'Agent 1' }],
      defaultAgentId: 'agent-1'
    });
  });

  it('runs a confirmed Copilot scenario preview with OAuth preflight', async () => {
    const scenario = { ...baseScenario(), serverIds: ['oauth-server'] };
    const preview = {
      run: {
        passed: true,
        finalAnswer: 'hello',
        failureReasons: [],
        checkResults: []
      }
    };
    mockSource.runScenarioPreview.mockResolvedValue(preview);
    mockEnsureOAuthForServers.mockResolvedValue(undefined);
    render(
      <ScenarioForm
        scenarios={[scenario]}
        agents={[{ id: 'agent-1', name: 'Agent 1' } as AgentConfig]}
        servers={[{ id: 'oauth-server', authType: 'oauth2' } as ServerConfig]}
        onChange={vi.fn()}
      />
    );

    await expect(
      invokeGlobalCopilotAction('preview_scenario', { scenarioId: scenario.id, agentId: 'agent-1' })
    ).resolves.toMatchObject({ scenarioId: scenario.id, passed: true, finalAnswer: 'hello' });
    expect(mockEnsureOAuthForServers).toHaveBeenCalledWith({
      serverNames: ['oauth-server'],
      source: mockSource
    });
    expect(mockSource.runScenarioPreview).toHaveBeenCalledWith(
      expect.objectContaining({ selectedAgentName: 'agent-1' })
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

  it('edits response_contains checks in place', async () => {
    const onChange = vi.fn();

    render(
      <ScenarioForm
        scenarios={[
          {
            ...baseScenario(),
            evalRules: [{ type: 'response_contains', value: 'success' }]
          }
        ]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit check 1' }));
    fireEvent.change(screen.getByPlaceholderText('Value'), {
      target: { value: 'approved' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update check' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toEqual([{ type: 'response_contains', value: 'approved' }]);
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

    fireEvent.click(screen.getAllByRole('combobox')[1]);
    fireEvent.click(screen.getByText('Tool Sequence'));
    expect(screen.getByText('Sequence steps')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Tool name'), {
      target: { value: 'search' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules[0]).toEqual({
      type: 'tool_sequence',
      sequence: ['search']
    });
  });

  it('renders a tool_sequence rule safely even when sequence data is missing', async () => {
    const onChange = vi.fn();

    render(
      <ScenarioForm
        scenarios={[
          {
            ...baseScenario(),
            evalRules: [{ type: 'tool_sequence' }]
          }
        ]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    expect(screen.getByText('Sequence')).toBeInTheDocument();
  });

  it('hides sequence steps after saving and reopens them on edit', async () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <ScenarioForm
        scenarios={[baseScenario()]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getAllByRole('combobox')[1]);
    fireEvent.click(screen.getByText('Tool Sequence'));
    fireEvent.change(screen.getByPlaceholderText('Tool name'), {
      target: { value: 'search' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];

    rerender(
      <ScenarioForm
        scenarios={updated}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    expect(screen.queryByText('Sequence steps')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Tool name')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('combobox')[1]);
    expect(screen.queryByText('Tool Sequence')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit check 1' }));

    expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('Tool Sequence');
    expect(screen.getByText('Sequence steps')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Tool name')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Add check' }));

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

  it('edits agent checks in place', async () => {
    const onChange = vi.fn();

    render(
      <ScenarioForm
        scenarios={[
          {
            ...baseScenario(),
            evalRules: [
              {
                type: 'agent_check',
                label: 'Logical range',
                prompt: 'Confirm the answer includes a valid logical time range.'
              }
            ]
          }
        ]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit check 1' }));
    fireEvent.change(screen.getByPlaceholderText('Prompt name'), {
      target: { value: 'Time range' }
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Judge prompt. Example: Confirm the answer includes a valid earliest and latest timestamp range, and that neither is 'Not available'."
      ),
      {
        target: { value: 'Confirm the answer includes a valid earliest and latest time range.' }
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Update check' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toEqual([
      {
        type: 'agent_check',
        label: 'Time range',
        prompt: 'Confirm the answer includes a valid earliest and latest time range.'
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
