import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgentScenario } from './agent.js';

describe('runAgentScenario', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('resolves current server headers before listing tools', async () => {
    const resolveServerRequestHeaders = vi.fn().mockResolvedValue({
      'oauth-server': { authorization: 'Bearer refreshed-token' }
    });
    const mcp = {
      listTools: vi.fn().mockResolvedValue([
        {
          name: 'search_tags',
          description: 'Search tags',
          inputSchema: { type: 'object', properties: {} }
        }
      ])
    };

    await runAgentScenario({
      scenario: {
        id: 'scenario-1',
        name: 'Scenario 1',
        prompt: 'Do the thing',
        servers: ['oauth-server'],
        agent: 'agent-1'
      } as any,
      agent: {
        provider: 'openai',
        model: 'gpt-4o-mini'
      } as any,
      mcp: mcp as any,
      resolveServerRequestHeaders,
      maxTurns: 0
    });

    expect(resolveServerRequestHeaders).toHaveBeenCalledWith(['oauth-server']);
    expect(mcp.listTools).toHaveBeenCalledWith('oauth-server', undefined, {
      authorization: 'Bearer refreshed-token'
    });
  });
});
