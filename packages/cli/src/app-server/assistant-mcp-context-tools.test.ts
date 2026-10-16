import { describe, expect, it, vi } from 'vitest';
import type { McpClientManager } from '@inspectr/mcplab-core';
import { ASSISTANT_TOOL_TIMEOUT_MESSAGE, ASSISTANT_TOOL_TIMEOUT_MS } from './assistant-common.js';
import { createMcpContextTools, mcpContextToolGuidance } from './assistant-mcp-context-tools.js';
import type { AssistantRuntimeDefinition } from './assistant-runtime-contract.js';
import { createScriptedRuntimeFactory } from '../../test-support/scripted-chat-model.js';

function fakeMcp() {
  return {
    listResources: vi.fn(async (server: string) => [
      { uri: `${server}://guide`, name: 'guide', mimeType: 'text/markdown' }
    ]),
    readResource: vi.fn(async (_server: string, uri: string) => [
      { uri, mimeType: 'text/markdown', text: '# Tag search guide' }
    ]),
    listPrompts: vi.fn(async () => [{ name: 'find_tags', description: 'Find tags' }]),
    getPrompt: vi.fn(async () => ({ messages: [{ role: 'user', text: 'Find tags for X' }] }))
  };
}

describe('MCP context tools', () => {
  it('offers only the features the selected servers advertise', () => {
    const mcp = fakeMcp() as unknown as McpClientManager;
    expect(createMcpContextTools(mcp, { resources: [], prompts: [] })).toEqual([]);
    expect(
      createMcpContextTools(mcp, { resources: ['docs'], prompts: [] }).map((tool) => tool.name)
    ).toEqual(['list_mcp_resources', 'read_mcp_resource']);
    expect(
      createMcpContextTools(mcp, { resources: [], prompts: ['docs'] }).map((tool) => tool.name)
    ).toEqual(['list_mcp_prompts', 'get_mcp_prompt']);
    expect(mcpContextToolGuidance({ resources: ['docs'], prompts: [] })).toHaveLength(1);
  });

  it('lists resources across servers with their server name and reads one', async () => {
    const mcp = fakeMcp();
    const [list, read] = createMcpContextTools(mcp as unknown as McpClientManager, {
      resources: ['docs', 'api'],
      prompts: []
    });
    await expect(list!.execute({})).resolves.toEqual({
      resources: [
        { server: 'docs', uri: 'docs://guide', name: 'guide', mimeType: 'text/markdown' },
        { server: 'api', uri: 'api://guide', name: 'guide', mimeType: 'text/markdown' }
      ],
      total: 2
    });
    await expect(read!.execute({ server: 'docs', uri: 'docs://guide' })).resolves.toMatchObject({
      contents: [{ text: '# Tag search guide' }]
    });
  });

  it('rejects servers that do not offer the feature', async () => {
    const [list] = createMcpContextTools(fakeMcp() as unknown as McpClientManager, {
      resources: ['docs'],
      prompts: []
    });
    await expect(list!.execute({ server: 'other' })).rejects.toThrow("Unknown server 'other'");
  });

  it('fills in a prompt template with string arguments', async () => {
    const mcp = fakeMcp();
    const [, get] = createMcpContextTools(mcp as unknown as McpClientManager, {
      resources: [],
      prompts: ['docs']
    });
    await expect(
      get!.execute({ server: 'docs', name: 'find_tags', arguments: { area: 'X' } })
    ).resolves.toMatchObject({ server: 'docs', messages: [{ text: 'Find tags for X' }] });
    expect(mcp.getPrompt).toHaveBeenCalledWith(
      'docs',
      'find_tags',
      { area: 'X' },
      expect.any(AbortSignal)
    );
  });

  it('times out a slow listing as a whole and aborts its MCP requests', async () => {
    vi.useFakeTimers();
    try {
      const mcp = fakeMcp();
      let requestSignal: AbortSignal | undefined;
      mcp.listResources.mockImplementation(async (_server: string, signal?: AbortSignal) => {
        requestSignal = signal;
        return new Promise<never>(() => {});
      });
      const [list] = createMcpContextTools(mcp as unknown as McpClientManager, {
        resources: ['docs'],
        prompts: []
      });
      const result = list!.execute({});
      const assertion = expect(result).rejects.toThrow(ASSISTANT_TOOL_TIMEOUT_MESSAGE);
      await vi.advanceTimersByTimeAsync(ASSISTANT_TOOL_TIMEOUT_MS);
      await assertion;
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads a resource through the agent without pausing for approval', async () => {
    const mcp = fakeMcp();
    let round = 0;
    const session = await createScriptedRuntimeFactory(async () => {
      round += 1;
      return round === 1
        ? {
            type: 'tool_call_request',
            text: 'Reading the guide',
            toolCalls: [
              {
                id: 'read-guide',
                name: 'read_mcp_resource',
                arguments: { server: 'docs', uri: 'docs://guide' }
              }
            ]
          }
        : { type: 'assistant_message', text: 'The guide says to search by prefix.' };
    }).create({
      assistant: 'scenario',
      agent: { provider: 'openai', model: 'test' },
      context: {} as AssistantRuntimeDefinition['context'],
      getSystemPrompt: () => 'Prompt',
      tools: createMcpContextTools(mcp as unknown as McpClientManager, {
        resources: ['docs'],
        prompts: []
      }),
      approvalPolicy: () => 'automatic'
    });
    await expect(session.sendMessage('Use the docs')).resolves.toMatchObject({
      type: 'assistant_message',
      text: 'The guide says to search by prefix.'
    });
    expect(mcp.readResource).toHaveBeenCalledWith('docs', 'docs://guide', expect.any(AbortSignal));
    await session.dispose();
  });
});
