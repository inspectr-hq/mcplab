import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBatchJudgeResponseFormat,
  buildSingleCheckJudgeResponseFormat,
  runAgentScenario
} from './agent.js';

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

describe('judge response formats', () => {
  it('returns json schema response format for the single-check judge contract', () => {
    expect(buildSingleCheckJudgeResponseFormat()).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'judge_result',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            pass: { type: 'boolean' },
            reason: { type: 'string' }
          },
          required: ['pass', 'reason'],
          additionalProperties: false
        }
      }
    });
  });

  it('returns json schema response format for the batched judge contract', () => {
    expect(buildBatchJudgeResponseFormat()).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'judge_batch_result',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  pass: { type: 'boolean' },
                  reason: { type: 'string' }
                },
                required: ['id', 'pass', 'reason'],
                additionalProperties: false
              }
            }
          },
          required: ['results'],
          additionalProperties: false
        }
      }
    });
  });
});
