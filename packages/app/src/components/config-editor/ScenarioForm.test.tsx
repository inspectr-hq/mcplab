import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderEvalRulePreview, ScenarioForm } from './ScenarioForm';
import type { Scenario, AgentConfig, ServerConfig } from '@/types/eval';

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
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toEqual([{ type: 'response_equals', value: 'success' }]);
  });

  it('lists tool input JSONPath checks in the rule type dropdown', () => {
    render(
      <ScenarioForm
        scenarios={[baseScenario()]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole('combobox')[1]);
    expect(screen.getByText('Tool input JSONPath')).toBeInTheDocument();
  });

  it('includes the tool name in tool input previews', () => {
    expect(
      renderEvalRulePreview({ type: 'tool_input_contains', tool: 'search_tags', value: 'Paris' })
    ).toBe('tool_input_contains: search_tags: Paris');
  });

  it('adds tool input contains checks', async () => {
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
    fireEvent.click(screen.getByText('Tool input contains'));
    fireEvent.change(screen.getByPlaceholderText('Tool name'), {
      target: { value: 'search_tags' }
    });
    fireEvent.change(screen.getByPlaceholderText('Text present in input'), {
      target: { value: 'TM5-BP2-CONC.1' }
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toEqual([
      {
        type: 'tool_input_contains',
        tool: 'search_tags',
        value: 'TM5-BP2-CONC.1'
      }
    ]);
  });

  it('adds tool input regex checks', async () => {
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
    fireEvent.click(screen.getByText('Tool input regex'));
    fireEvent.change(screen.getByPlaceholderText('Tool name'), {
      target: { value: 'search_tags' }
    });
    fireEvent.change(screen.getAllByPlaceholderText('Regex pattern')[0]!, {
      target: { value: 'TM5-BP2-\\d+' }
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules).toEqual([
      {
        type: 'tool_input_regex',
        tool: 'search_tags',
        value: 'TM5-BP2-\\d+'
      }
    ]);
  });

  it('uses discovered tools for tool input rule selection', async () => {
    mockSource.discoverToolsForAnalysis.mockResolvedValue({
      servers: [{ tools: [{ name: 'search_tags' }] }]
    });
    const onChange = vi.fn();
    render(
      <ScenarioForm
        scenarios={[{ ...baseScenario(), serverIds: ['server-1'] }]}
        agents={[] as AgentConfig[]}
        servers={
          [{ id: 'server-1', name: 'Server', transport: 'streamable-http' }] as ServerConfig[]
        }
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load tools' }));
    await waitFor(() => expect(screen.getByText('Refresh tools')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('combobox')[1]);
    fireEvent.click(screen.getByText('Tool input contains'));
    fireEvent.click(screen.getByText('Select tool'));
    expect(screen.getByText('search_tags')).toBeInTheDocument();
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

  it('creates and edits required tool OR groups in place', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ScenarioForm scenarios={[baseScenario()]} agents={[]} servers={[]} onChange={onChange} />
    );
    fireEvent.click(screen.getAllByRole('combobox')[1]);
    fireEvent.click(screen.getAllByText('Required Tool').at(-1)!);
    fireEvent.change(screen.getByPlaceholderText('Tool name'), { target: { value: ' lookup ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add alternative' }));
    fireEvent.change(screen.getAllByPlaceholderText('Tool name')[1]!, {
      target: { value: 'search' }
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    const created = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(created[0]?.evalRules).toEqual([{ type: 'required_tool', value: 'lookup|search' }]);

    onChange.mockClear();
    rerender(<ScenarioForm scenarios={created} agents={[]} servers={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit check 1' }));
    expect(
      screen.getAllByPlaceholderText('Tool name').map((input) => (input as HTMLInputElement).value)
    ).toEqual(['lookup', 'search']);
    fireEvent.change(screen.getAllByPlaceholderText('Tool name')[0]!, {
      target: { value: 'lookup_v2' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update check' }));
    const edited = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(edited[0]?.evalRules).toEqual([{ type: 'required_tool', value: 'lookup_v2|search' }]);
  });

  it('blocks empty and duplicate tool alternatives', () => {
    const onChange = vi.fn();
    render(
      <ScenarioForm scenarios={[baseScenario()]} agents={[]} servers={[]} onChange={onChange} />
    );
    fireEvent.click(screen.getAllByRole('combobox')[1]);
    fireEvent.click(screen.getAllByText('Required Tool').at(-1)!);
    const save = screen.getAllByRole('button', { name: 'Add' })[0]!;
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Tool name'), {
      target: { value: 'lookup|search' }
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Use Add alternative');
    expect((screen.getByPlaceholderText('Tool name') as HTMLInputElement).value).toBe(
      'lookup|search'
    );
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Tool name'), { target: { value: 'lookup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add alternative' }));
    fireEvent.change(screen.getAllByPlaceholderText('Tool name')[1]!, {
      target: { value: 'lookup' }
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Tool already added.');
    expect(save).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('warns on partially forbidden alternatives while retaining both rules', () => {
    const scenario = {
      ...baseScenario(),
      evalRules: [
        { type: 'required_tool', value: 'lookup|search' },
        { type: 'forbidden_tool', value: 'lookup' }
      ] as Scenario['evalRules']
    };
    render(<ScenarioForm scenarios={[scenario]} agents={[]} servers={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('note')).toHaveTextContent('includes forbidden alternative');
    expect(screen.getByText('lookup OR search')).toBeInTheDocument();
    expect(screen.getByText('lookup', { selector: 'span' })).toBeInTheDocument();
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
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Sequence step alternatives 1' }), {
      key: 'Enter'
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.evalRules[0]).toEqual({
      type: 'tool_sequence',
      sequence: ['search']
    });
  });

  it('saves repeated sequence steps with canonical alternatives and reopens them', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ScenarioForm scenarios={[baseScenario()]} agents={[]} servers={[]} onChange={onChange} />
    );
    fireEvent.click(screen.getAllByRole('combobox')[1]);
    fireEvent.click(screen.getByText('Tool Sequence'));
    for (const [first, second] of [
      [' lookup ', 'search'],
      [' lookup ', 'search']
    ]) {
      fireEvent.change(screen.getByLabelText('Sequence step alternatives 1'), {
        target: { value: first }
      });
      fireEvent.click(screen.getAllByRole('button', { name: 'Add alternative' })[0]!);
      fireEvent.change(screen.getByLabelText('Sequence step alternatives 2'), {
        target: { value: second }
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
    }
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    const saved = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(saved[0]?.evalRules).toEqual([
      { type: 'tool_sequence', sequence: ['lookup|search', 'lookup|search'] }
    ]);
    rerender(<ScenarioForm scenarios={saved} agents={[]} servers={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit check 1' }));
    expect(screen.getByText('Sequence steps')).toBeInTheDocument();
    expect(
      (screen.getByLabelText('Sequence step 1 alternatives 1') as HTMLInputElement).value
    ).toBe('lookup');
    expect(
      (screen.getByLabelText('Sequence step 1 alternatives 2') as HTMLInputElement).value
    ).toBe('search');
    expect(
      (screen.getByLabelText('Sequence step 2 alternatives 1') as HTMLInputElement).value
    ).toBe('lookup');
    expect(
      (screen.getByLabelText('Sequence step 2 alternatives 2') as HTMLInputElement).value
    ).toBe('search');
  });

  it('edits existing sequence alternatives and blocks invalid or rejected steps from saving', () => {
    const onChange = vi.fn();
    render(
      <ScenarioForm
        scenarios={[
          {
            ...baseScenario(),
            evalRules: [{ type: 'tool_sequence', sequence: ['fetch|search', 'finish'] }]
          }
        ]}
        agents={[]}
        servers={[]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit check 1' }));

    const updateSequence = screen.getByRole('button', { name: 'Update sequence' });
    const save = screen.getAllByRole('button', { name: 'Add' })[0]!;
    const stepOne = screen.getByLabelText('Sequence step 1 alternatives 1') as HTMLInputElement;
    const stepTwo = screen.getByLabelText('Sequence step 2 alternatives 1') as HTMLInputElement;
    const stepOneSecond = screen.getByLabelText(
      'Sequence step 1 alternatives 2'
    ) as HTMLInputElement;

    fireEvent.change(stepTwo, { target: { value: 'archive' } });
    expect(stepTwo.value).toBe('archive');
    fireEvent.change(stepTwo, { target: { value: 'finish' } });
    fireEvent.change(stepTwo, { target: { value: '' } });
    expect(updateSequence).toBeDisabled();
    expect(save).toBeDisabled();

    fireEvent.change(stepTwo, { target: { value: 'finish' } });
    fireEvent.change(stepOneSecond, { target: { value: 'fetch' } });
    expect(updateSequence).toBeDisabled();

    fireEvent.change(stepOne, { target: { value: 'fetch|other' } });
    expect(
      screen
        .getAllByRole('alert')
        .some((alert) => alert.textContent?.includes('Use Add alternative'))
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Add step' })).toBeDisabled();
    expect(updateSequence).toBeDisabled();
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Sequence step alternatives 1'), {
      target: { value: 'fresh|step' }
    });
    expect(
      screen
        .getAllByRole('alert')
        .some((alert) => alert.textContent?.includes('Use Add alternative'))
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Add step' })).toBeDisabled();
    expect(updateSequence).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getAllByRole('combobox')[1]);
    expect(screen.queryByText('Tool Sequence')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit check 1' }));

    expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('Tool Sequence');
    expect(screen.getByText('Sequence steps')).toBeInTheDocument();
    expect(screen.getByLabelText('Sequence step 1 alternatives 1')).toBeInTheDocument();
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

  it('enables tool inputs in judge context', async () => {
    const onChange = vi.fn();

    render(
      <ScenarioForm
        scenarios={[
          {
            ...baseScenario(),
            evalRules: [{ type: 'agent_check', label: 'Check', prompt: 'Verify.' }]
          }
        ]}
        agents={[] as AgentConfig[]}
        servers={[] as ServerConfig[]}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByLabelText('Include tool inputs'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const updated = onChange.mock.calls.at(-1)?.[0] as Scenario[];
    expect(updated[0]?.agentContext).toEqual({ include_tool_inputs: true });
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
