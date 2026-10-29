import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openAiCreate = vi.hoisted(() => vi.fn());
const openAiOptions = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor(options: unknown) {
      openAiOptions(options);
    }
    chat = { completions: { create: openAiCreate } };
  }
}));

const anthropicCreate = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: anthropicCreate };
  }
}));

import {
  buildBatchJudgeResponseFormat,
  buildSingleCheckJudgeResponseFormat,
  chatWithAgent,
  runAgentScenario
} from './agent.js';
import { evaluateScenario } from './eval.js';

describe('Azure Foundry agents', () => {
  beforeEach(() => {
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', 'https://foundry.example/');
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', 'foundry-key');
    vi.stubEnv('AZURE_OPENAI_API_KEY', 'legacy-key');
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://legacy.example');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'global-deployment');
    openAiOptions.mockClear();
    openAiCreate.mockReset().mockResolvedValue({
      model: 'resolved-model',
      choices: [{ message: { content: 'Ready.', tool_calls: [] } }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    openAiCreate.mockReset();
  });
  const agent = { provider: 'azure_foundry' as const, model: 'agent-deployment' };
  const messages = [{ role: 'user' as const, content: 'Hello' }];
  it('uses the selected deployment through v1 without the global legacy deployment or api-version', async () => {
    const result = await chatWithAgent({ agent, messages });
    expect(openAiOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'foundry-key',
        baseURL: 'https://foundry.example/openai/v1'
      })
    );
    expect(openAiOptions.mock.calls[0][0].defaultQuery).toBeUndefined();
    expect(openAiCreate.mock.calls[0][0].model).toBe('agent-deployment');
    expect(result).toMatchObject({
      content: 'Ready.',
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 }
    });
  });
  it('uses separate deployments for two agents with the same backend credentials', async () => {
    await chatWithAgent({ agent, messages });
    await chatWithAgent({ agent: { ...agent, model: 'other-deployment' }, messages });
    expect(openAiCreate.mock.calls.map(([request]) => request.model)).toEqual([
      'agent-deployment',
      'other-deployment'
    ]);
  });
  it('rejects a blank per-agent deployment without using the legacy global deployment', async () => {
    await expect(chatWithAgent({ agent: { ...agent, model: ' ' }, messages })).rejects.toThrow(
      'deployment name'
    );
    expect(openAiCreate).not.toHaveBeenCalled();
  });
  it('supports compatible models that accept max_tokens instead of max_completion_tokens', async () => {
    openAiCreate.mockRejectedValueOnce(new Error('max_completion_tokens is not supported'));
    await chatWithAgent({ agent: { ...agent, max_tokens: 32 }, messages });
    expect(openAiCreate.mock.calls[0][0]).toMatchObject({ max_completion_tokens: 32 });
    expect(openAiCreate.mock.calls[1][0]).toMatchObject({
      model: 'agent-deployment',
      max_tokens: 32
    });
    expect(openAiCreate.mock.calls[1][0]).not.toHaveProperty('max_completion_tokens');
  });
  it('reuses an existing Azure key when the dedicated key is absent', async () => {
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', '');
    await chatWithAgent({ agent, messages });
    expect(openAiOptions.mock.calls[0][0].apiKey).toBe('legacy-key');
  });
  it('requires an explicit Foundry endpoint and a backend key', async () => {
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', '');
    await expect(chatWithAgent({ agent, messages })).rejects.toThrow('AZURE_FOUNDRY_ENDPOINT');
    vi.stubEnv('AZURE_FOUNDRY_ENDPOINT', 'https://foundry.example');
    vi.stubEnv('AZURE_FOUNDRY_API_KEY', '');
    vi.stubEnv('AZURE_OPENAI_API_KEY', '');
    await expect(chatWithAgent({ agent, messages })).rejects.toThrow('AZURE_OPENAI_API_KEY');
  });
  it('uses the per-agent Azure deployment with the legacy endpoint and version', async () => {
    vi.stubEnv('AZURE_OPENAI_API_VERSION', 'legacy-version');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENTS', 'legacy-model-field,global-deployment');
    await chatWithAgent({
      agent: { provider: 'azure_openai', model: 'legacy-model-field' },
      messages
    });
    expect(openAiOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'legacy-key',
        baseURL: 'https://legacy.example/openai/deployments/legacy-model-field',
        defaultQuery: { 'api-version': 'legacy-version' }
      })
    );
    expect(openAiCreate.mock.calls[0][0].model).toBe('legacy-model-field');
  });
  it('keeps legacy model suggestions on the global deployment unless configured as deployments', async () => {
    await chatWithAgent({ agent: { provider: 'azure_openai', model: 'gpt-4o' }, messages });
    expect(openAiOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://legacy.example/openai/deployments/global-deployment'
      })
    );
    expect(openAiCreate.mock.calls[0][0].model).toBe('global-deployment');
  });
  it('falls back to the legacy Azure deployment when the agent has no deployment', async () => {
    await chatWithAgent({ agent: { provider: 'azure_openai', model: ' ' }, messages });
    expect(openAiOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://legacy.example/openai/deployments/global-deployment'
      })
    );
    expect(openAiCreate.mock.calls[0][0].model).toBe('global-deployment');
  });
  it('supports tools and structured judge output and propagates the request signal', async () => {
    const controller = new AbortController();
    openAiCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              { id: 'call', function: { name: 'search', arguments: '{"query":"test"}' } }
            ]
          }
        }
      ]
    });
    const result = await chatWithAgent({
      agent,
      messages,
      tools: [{ name: 'search', parameters: { type: 'object' } }],
      responseFormat: buildSingleCheckJudgeResponseFormat(),
      signal: controller.signal
    });
    expect(openAiCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'agent-deployment',
        tools: [expect.objectContaining({ type: 'function' })],
        response_format: buildSingleCheckJudgeResponseFormat()
      }),
      { signal: controller.signal }
    );
    expect(result.tool_calls).toEqual([
      { id: 'call', name: 'search', arguments: { query: 'test' } }
    ]);
  });
});

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

  it.each(['transport', 'headers'])(
    'does not treat a %s failure as an MCP tool output',
    async (failure) => {
      openAiCreate
        .mockReset()
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  { id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } }
                ]
              }
            }
          ]
        })
        .mockResolvedValueOnce({ choices: [{ message: { content: 'Finished', tool_calls: [] } }] });
      const mcp = {
        listTools: vi
          .fn()
          .mockResolvedValue([{ name: 'search', inputSchema: { type: 'object', properties: {} } }]),
        callTool: vi.fn().mockRejectedValue(new Error('connection failed'))
      };
      const resolveServerRequestHeaders =
        failure === 'headers'
          ? vi.fn().mockResolvedValueOnce({}).mockRejectedValue(new Error('connection failed'))
          : undefined;
      const run = await runAgentScenario({
        scenario: { id: 'example', prompt: 'Search', servers: ['server'], agent: 'agent' } as any,
        agent: { provider: 'openai', model: 'gpt-test' } as any,
        mcp: mcp as any,
        resolveServerRequestHeaders,
        maxTurns: 2
      });
      const evaluation = evaluateScenario(
        'Finished',
        ['search'],
        {
          tool_output_assertions: [{ type: 'contains', tool: 'search', value: 'connection failed' }]
        },
        run.toolCalls
      );
      expect(evaluation.pass).toBe(false);
      expect(evaluation.failures).toContain(
        'Tool output assertion failed: output not available for search'
      );
      expect(openAiCreate.mock.calls[1][0].messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'tool',
            content: expect.stringContaining('connection failed')
          })
        ])
      );
    }
  );

  it('allows assertions against real MCP error responses', async () => {
    openAiCreate
      .mockReset()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } }
              ]
            }
          }
        ]
      })
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Finished', tool_calls: [] } }] });
    const response = { isError: true, content: [{ type: 'text', text: 'No results' }] };
    const run = await runAgentScenario({
      scenario: { id: 'example', prompt: 'Search', servers: ['server'], agent: 'agent' } as any,
      agent: { provider: 'openai', model: 'gpt-test' } as any,
      mcp: {
        listTools: vi
          .fn()
          .mockResolvedValue([{ name: 'search', inputSchema: { type: 'object', properties: {} } }]),
        callTool: vi.fn().mockResolvedValue(response)
      } as any,
      maxTurns: 2
    });
    const evaluation = evaluateScenario(
      'Finished',
      ['search'],
      {
        tool_output_assertions: [
          { type: 'jsonpath', tool: 'search', path: '$.isError', equals: true }
        ]
      },
      run.toolCalls
    );
    expect(evaluation.pass).toBe(true);
    expect(run.toolCalls[0].result).toEqual(response);
  });

  it('tags tool listing with the request id, like tool calls', async () => {
    const mcp = { listTools: vi.fn().mockResolvedValue([]) };

    await runAgentScenario({
      scenario: {
        id: 'scenario-1',
        prompt: 'Do the thing',
        servers: ['plain-server'],
        agent: 'agent-1'
      } as any,
      agent: { provider: 'openai', model: 'gpt-4o-mini' } as any,
      mcp: mcp as any,
      requestId: 'mcplab-run:run-1:scenario-1:agent-1:run1',
      maxTurns: 0
    });

    expect(mcp.listTools).toHaveBeenCalledWith('plain-server', undefined, {
      'x-request-id': 'mcplab-run:run-1:scenario-1:agent-1:run1'
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
      callTool: vi.fn().mockResolvedValue({ matches: ['TM5'], ok: 'server-ok', durationMs: 42 })
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

    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        name: 'search_tags',
        result: { matches: ['TM5'], ok: 'server-ok', durationMs: 42 }
      })
    ]);

    expect(startLlm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        metadata: { ls_provider: 'openai', ls_model_name: 'gpt-test' },
        inputs: {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Find the tag profile.' }] }],
          tools: [
            {
              name: 'search_tags',
              description: 'Search tags',
              parameters: { type: 'object', properties: { name: { type: 'string' } } }
            }
          ]
        }
      })
    );
    expect(llmEnds[0]).toHaveBeenCalledWith({
      outputs: {
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'tool_call', id: 'call-1', name: 'search_tags', args: { name: 'TM5' } }
            ]
          }
        ],
        usage_metadata: { input_tokens: 11, output_tokens: 7, total_tokens: 18 }
      }
    });
    expect(startLlm).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        inputs: {
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'Find the tag profile.' }] },
            {
              role: 'assistant',
              content: [
                { type: 'tool_call', id: 'call-1', name: 'search_tags', args: { name: 'TM5' } }
              ]
            },
            {
              role: 'tool',
              tool_call_id: 'call-1',
              name: 'search_tags',
              content: [
                { type: 'text', text: '{"matches":["TM5"],"ok":"server-ok","durationMs":42}' }
              ]
            }
          ],
          tools: [
            {
              name: 'search_tags',
              description: 'Search tags',
              parameters: { type: 'object', properties: { name: { type: 'string' } } }
            }
          ]
        }
      })
    );
    expect(startTool).toHaveBeenCalledWith({
      server: 'server-1',
      tool: 'search_tags',
      inputs: { name: 'TM5' }
    });
    expect(toolEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: {
          matches: ['TM5'],
          ok: 'server-ok',
          durationMs: 42,
          _mcplab: { ok: true, durationMs: expect.any(Number) }
        }
      })
    );
    expect(llmEnds[1]).toHaveBeenCalledWith({
      outputs: {
        messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'The tag profile is ready.' }] }
        ],
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

describe('models that reject temperature', () => {
  const messages = [{ role: 'user' as const, content: 'Hello' }];
  afterEach(() => {
    vi.unstubAllEnvs();
    anthropicCreate.mockReset();
    openAiCreate.mockReset();
  });

  it('fails an Anthropic request with what to change instead of retrying', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    const rejection = new Error(
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"`temperature` is deprecated for this model."}}'
    );
    anthropicCreate.mockRejectedValue(rejection);
    const result = chatWithAgent({
      agent: { provider: 'anthropic', model: 'luna-6', temperature: 0.2 },
      messages
    });
    await expect(result).rejects.toThrow(
      "`luna-6` doesn't accept temperature. Remove it from this agent's settings."
    );
    await expect(result).rejects.toMatchObject({ cause: rejection });
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it('fails an OpenAI request with what to change instead of retrying', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    openAiCreate.mockRejectedValue(
      new Error(
        "400 Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported."
      )
    );
    await expect(
      chatWithAgent({ agent: { provider: 'openai', model: 'o4-mini', temperature: 0.2 }, messages })
    ).rejects.toThrow("`o4-mini` doesn't accept temperature.");
    expect(openAiCreate).toHaveBeenCalledTimes(1);
  });

  it('passes other request errors through unchanged', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    anthropicCreate.mockRejectedValue(new Error('400 max_tokens is too large'));
    await expect(
      chatWithAgent({
        agent: { provider: 'anthropic', model: 'luna-6', temperature: 0.2 },
        messages
      })
    ).rejects.toThrow('400 max_tokens is too large');
  });
});
