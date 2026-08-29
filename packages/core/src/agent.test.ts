import { beforeEach, describe, expect, it, vi } from 'vitest';

const openAiCreate = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: openAiCreate } };
  }
}));

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

  it('exports chat-shaped LLM output and tool spans through the trace interface', async () => {
    openAiCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'search_tags', arguments: '{"name":"TM5"}' }
                }
              ]
            }
          }
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'The tag profile is ready.', tool_calls: [] } }],
        usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 }
      });

    const llmEnds = [vi.fn(), vi.fn()];
    const toolEnd = vi.fn();
    const startLlm = vi
      .fn()
      .mockReturnValueOnce({ end: llmEnds[0] })
      .mockReturnValueOnce({ end: llmEnds[1] });
    const startTool = vi.fn().mockReturnValue({ end: toolEnd });
    const mcp = {
      listTools: vi.fn().mockResolvedValue([
        {
          name: 'search_tags',
          description: 'Search tags',
          inputSchema: { type: 'object', properties: { name: { type: 'string' } } }
        }
      ]),
      callTool: vi.fn().mockResolvedValue({ matches: ['TM5'] })
    };

    const result = await runAgentScenario({
      scenario: {
        id: 'scenario-1',
        name: 'Scenario 1',
        prompt: 'Find the tag profile.',
        servers: ['server-1'],
        agent: 'agent-1'
      } as any,
      agent: { provider: 'openai', model: 'gpt-test' } as any,
      mcp: mcp as any,
      maxTurns: 2,
      trace: { startLlm, startTool, end: vi.fn() }
    });

    expect(startLlm).toHaveBeenNthCalledWith(1, expect.objectContaining({
      metadata: { ls_provider: 'openai', ls_model_name: 'gpt-test' },
      inputs: {
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Find the tag profile.' }] }],
        tools: [{
          name: 'search_tags',
          description: 'Search tags',
          parameters: { type: 'object', properties: { name: { type: 'string' } } }
        }]
      }
    }));
    expect(llmEnds[0]).toHaveBeenCalledWith({
      outputs: {
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_call', id: 'call-1', name: 'search_tags', args: { name: 'TM5' } }]
          }
        ],
        usage_metadata: { input_tokens: 11, output_tokens: 7, total_tokens: 18 }
      }
    });
    expect(startLlm).toHaveBeenNthCalledWith(2, expect.objectContaining({
      inputs: {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Find the tag profile.' }] },
          {
            role: 'assistant',
            content: [{ type: 'tool_call', id: 'call-1', name: 'search_tags', args: { name: 'TM5' } }]
          },
          {
            role: 'tool',
            tool_call_id: 'call-1',
            name: 'search_tags',
            content: [{ type: 'text', text: '{"matches":["TM5"]}' }]
          }
        ],
        tools: [{
          name: 'search_tags',
          description: 'Search tags',
          parameters: { type: 'object', properties: { name: { type: 'string' } } }
        }]
      }
    }));
    expect(startTool).toHaveBeenCalledWith({
      server: 'server-1',
      tool: 'search_tags',
      inputs: { name: 'TM5' }
    });
    expect(toolEnd).toHaveBeenCalledWith(expect.objectContaining({
      outputs: expect.objectContaining({ matches: ['TM5'], ok: true })
    }));
    expect(llmEnds[1]).toHaveBeenCalledWith({
      outputs: {
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'The tag profile is ready.' }] }],
        usage_metadata: { input_tokens: 20, output_tokens: 6, total_tokens: 26 }
      }
    });
    expect(result.finalText).toBe('The tag profile is ready.');
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
