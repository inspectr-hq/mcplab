import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aggregateResults } from '@inspectr/mcplab-core';

const mocks = vi.hoisted(() => ({
  runAll: vi.fn(),
  loadConfig: vi.fn(),
  loadWorkspaceSettingsOverrides: vi.fn(),
  readLibraryAgentsAndServers: vi.fn()
}));
vi.mock('@inspectr/mcplab-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@inspectr/mcplab-core')>()),
  ...mocks
}));
import { registerTools } from './runtime.js';

describe('immediate MCP decision evaluation', () => {
  const agent = { provider: 'openai' as const, model: 'gpt-5-mini' };
  const decision = {
    provider: 'ollama' as const,
    model: 'clef-flash',
    passThreshold: 0.9,
    failThreshold: 0.1,
    baseUrl: 'http://localhost:11434'
  };
  let runTool: (args: Record<string, unknown>) => Promise<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({
      config: {
        name: 'test',
        servers: {},
        agents: {},
        scenarios: [
          {
            id: 'semantic',
            servers: [],
            prompt: 'Answer',
            eval: { agent_assertions: [{ label: 'Check', prompt: 'Valid?' }] }
          }
        ]
      },
      hash: 'test'
    });
    mocks.readLibraryAgentsAndServers.mockReturnValue({ agents: { judge: agent }, servers: {} });
    mocks.runAll.mockResolvedValue({
      runDir: '/tmp/mcplab-mcp-test',
      results: aggregateResults({
        runId: 'test',
        timestamp: '2026-10-13T00:00:00Z',
        configHash: 'test',
        cliVersion: 'test',
        scenarioRuns: []
      })
    });
    registerTools({
      registerTool: (name: string, _config: unknown, cb: typeof runTool) => {
        if (name === 'mcplab_run_eval') runTool = cb;
        return { name };
      }
    } as any);
  });

  it.each(['deleted', 'browser'])(
    'runs deterministic checks despite a %s workspace judge',
    async (name) => {
      mocks.loadConfig.mockReturnValue({
        config: {
          servers: {},
          agents: {},
          scenarios: [
            {
              id: 'deterministic',
              servers: [],
              prompt: 'Answer',
              eval: { response_assertions: [{ type: 'contains', value: 'done' }] }
            }
          ]
        }
      });
      mocks.loadWorkspaceSettingsOverrides.mockReturnValue({
        evaluation_judge_agent_name: name,
        evaluation_decision: decision
      });
      mocks.readLibraryAgentsAndServers.mockReturnValue({
        agents: {
          main: agent,
          browser: { type: 'browser', provider: 'polo', url: 'https://polo.example' }
        },
        servers: {}
      });
      const result = await runTool({ config_path: '/tmp/eval.yaml' });
      expect(result.isError).not.toBe(true);
      const options = mocks.runAll.mock.calls[0][1];
      expect(options.evaluationJudge).toBeUndefined();
      expect(options.evaluationDecision).toBeUndefined();
    }
  );

  it('uses shared workspace decision configuration and LLM judge backup', async () => {
    mocks.loadWorkspaceSettingsOverrides.mockReturnValue({
      evaluation_judge_agent_name: 'judge',
      evaluation_decision: decision
    });
    const result = await runTool({ config_path: '/tmp/eval.yaml' });
    expect(result.isError).not.toBe(true);
    expect(mocks.runAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        evaluationDecision: decision,
        evaluationJudge: { name: 'judge', agent }
      })
    );
    expect(mocks.loadWorkspaceSettingsOverrides).toHaveBeenCalledWith(
      mocks.readLibraryAgentsAndServers.mock.calls[0][0]
    );
  });

  it('returns loaded config warnings without logging them', async () => {
    const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const duplicateWarning =
      'Scenario "semantic": tool_constraints.required_tools[0] includes forbidden alternative.';
    mocks.loadConfig.mockReturnValue({
      config: { servers: {}, agents: {}, scenarios: [] },
      warnings: [duplicateWarning, 'Unrelated warning']
    });
    mocks.runAll.mockImplementation(async () => {
      return {
        runDir: '/tmp/mcplab-mcp-test',
        results: aggregateResults({
          runId: 'test',
          timestamp: '2026-10-13T00:00:00Z',
          configHash: 'test',
          cliVersion: 'test',
          scenarioRuns: []
        })
      };
    });

    const result = await runTool({ config_path: '/tmp/eval.yaml' });
    expect(result.structuredContent.warnings).toEqual([duplicateWarning, 'Unrelated warning']);
    expect(consoleWarning).not.toHaveBeenCalled();
    consoleWarning.mockRestore();
  });

  it('preserves legacy judge-only workspaces', async () => {
    mocks.loadWorkspaceSettingsOverrides.mockReturnValue({ evaluation_judge_agent_name: 'judge' });
    await runTool({ config_path: '/tmp/eval.yaml' });
    expect(mocks.runAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        evaluationDecision: undefined,
        evaluationJudge: { name: 'judge', agent }
      })
    );
  });

  it('passes malformed persisted decision settings through for shared fallback handling', async () => {
    const malformed = { provider: 'missing', passThreshold: 2 };
    mocks.loadWorkspaceSettingsOverrides.mockReturnValue({
      evaluation_judge_agent_name: 'judge',
      evaluation_decision: malformed
    });
    await runTool({ config_path: '/tmp/eval.yaml' });
    expect(mocks.runAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        evaluationDecision: malformed,
        evaluationJudge: { name: 'judge', agent }
      })
    );
  });

  it('rejects a browser agent selected as judge before starting execution', async () => {
    mocks.loadWorkspaceSettingsOverrides.mockReturnValue({
      evaluation_judge_agent_name: 'judge',
      evaluation_decision: decision
    });
    mocks.readLibraryAgentsAndServers.mockReturnValue({
      agents: { judge: { type: 'browser', provider: 'polo', url: 'https://polo.example' } },
      servers: {}
    });
    const result = await runTool({ config_path: '/tmp/eval.yaml' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('LLM');
    expect(mocks.runAll).not.toHaveBeenCalled();
  });
});
