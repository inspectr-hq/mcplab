import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { runAgent } = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock('./agent.js', async (original) => ({
  ...(await original<typeof import('./agent.js')>()),
  runAgentScenario: runAgent
}));
import { runAll } from './runner.js';
import { McpClientManager } from './mcp.js';
import type { ExecutableEvalConfig } from './types.js';
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
function config(expression = 'search|lookup'): ExecutableEvalConfig {
  return {
    servers: { s: { transport: 'streamable-http', url: 'https://mcp.example' } },
    agents: { a: { provider: 'openai', model: 'test' } },
    scenarios: [
      { id: 'first', agent: 'a', servers: ['s'], prompt: 'first' },
      {
        id: 'second',
        agent: 'a',
        servers: ['s'],
        prompt: 'second',
        eval: { tool_constraints: { required_tools: [expression] } }
      }
    ]
  } as ExecutableEvalConfig;
}
function options() {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-preflight-'));
  roots.push(root);
  return { runsPerScenario: 2, configHash: 'test', cliVersion: 'test', runsDir: root };
}
describe('tool-rule execution preflight', () => {
  it('rejects malformed later scenarios before connecting or dispatching', async () => {
    const connect = vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    await expect(runAll(config('search|'), options())).rejects.toThrow('second');
    expect(connect).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });
  it('rejects alias collisions across selected scenarios before any attempts', async () => {
    vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
    vi.spyOn(McpClientManager.prototype, 'listTools').mockResolvedValue([
      { name: 'search', inputSchema: {} }
    ]);
    vi.spyOn(McpClientManager.prototype, 'getRequestHeadersForServers').mockResolvedValue({});
    const progress = vi.fn();
    await expect(
      runAll(config('MCPLab:search|search'), { ...options(), onProgress: progress })
    ).rejects.toThrow('duplicate');
    expect(runAgent).not.toHaveBeenCalled();
    expect(progress.mock.calls.some(([event]) => event.type === 'scenario_run_started')).toBe(
      false
    );
  });
  it('reuses authenticated discovery and reports partial-forbidden alias warnings before attempts', async () => {
    vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
    const discovery = vi.spyOn(McpClientManager.prototype, 'listTools').mockResolvedValue([
      { name: 'search', inputSchema: {} },
      { name: 'lookup', inputSchema: {} }
    ]);
    vi.spyOn(McpClientManager.prototype, 'getRequestHeadersForServers').mockResolvedValue({});
    runAgent.mockResolvedValue({
      finalText: 'ok',
      toolCalls: [{ name: 'lookup', arguments: {}, result: {} }],
      toolDurationsMs: [],
      availableToolNames: ['search', 'lookup'],
      toolSequence: ['lookup'],
      traceMessages: [],
      traceModel: 'test',
      traceProvider: 'openai',
      traceStartedAt: '2026-10-20T10:00:00Z',
      traceEndedAt: '2026-10-20T10:00:01Z'
    });
    const input = config('MCPLab:search | lookup');
    input.scenarios[1].eval!.tool_constraints!.forbidden_tools = ['search'];
    const warnings: string[] = [];
    const auth = vi.fn().mockResolvedValue({ s: { authorization: 'Bearer token' } });
    const result = await runAll(input, {
      ...options(),
      resolveMcpServerAuthHeaders: auth,
      onWarning: (warning) => {
        expect(runAgent).not.toHaveBeenCalled();
        warnings.push(warning);
      }
    });
    expect(warnings.join(' ')).toContain('forbidden');
    expect(discovery).toHaveBeenCalledTimes(2);
    expect(discovery.mock.calls[0][2]).toMatchObject({ authorization: 'Bearer token' });
    expect(runAgent.mock.calls.every(([args]) => args.preparedTools instanceof Map)).toBe(true);
    expect(result.results.scenarios[1].tool_constraints_stats?.required).toEqual({
      'search|lookup': 2
    });
    expect(input.scenarios[1].eval!.tool_constraints!.required_tools).toEqual([
      'MCPLab:search | lookup'
    ]);
  });
  it('keeps shared preflight running when one child is stopped during discovery', async () => {
    const child = new AbortController();
    vi.spyOn(McpClientManager.prototype, 'connectAll').mockResolvedValue();
    vi.spyOn(McpClientManager.prototype, 'disconnectAll').mockResolvedValue();
    vi.spyOn(McpClientManager.prototype, 'getRequestHeadersForServers').mockResolvedValue({});
    vi.spyOn(McpClientManager.prototype, 'listTools').mockImplementation(
      async (_server, signal) => {
        child.abort();
        if (signal?.aborted) throw new Error('shared discovery aborted');
        return [{ name: 'lookup', inputSchema: {} }];
      }
    );
    runAgent.mockResolvedValue({
      finalText: 'ok',
      toolCalls: [{ name: 'lookup', arguments: {}, result: {} }],
      toolDurationsMs: [],
      availableToolNames: ['lookup'],
      toolSequence: ['lookup'],
      traceMessages: [],
      traceModel: 'test',
      traceProvider: 'openai',
      traceStartedAt: '2026-10-20T10:00:00Z',
      traceEndedAt: '2026-10-20T10:00:01Z'
    });
    const result = await runAll(config(), {
      ...options(),
      scenarioSignal: (scenario) => (scenario.id === 'first' ? child.signal : undefined)
    });
    expect(result.results.scenarios.map((scenario) => scenario.scenario_id)).toEqual(['second']);
    expect(runAgent).toHaveBeenCalledTimes(2);
  });
});
