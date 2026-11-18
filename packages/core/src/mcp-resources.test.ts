import { describe, expect, it, vi } from 'vitest';
import { McpClientManager } from './mcp.js';

function managerWith(client: Record<string, unknown>) {
  const manager = new McpClientManager();
  (manager as any).clients.set('docs', client);
  return manager;
}

describe('McpClientManager resources and prompts', () => {
  it('reports the optional features a server advertises', () => {
    const manager = managerWith({ getServerCapabilities: () => ({ resources: {}, tools: {} }) });
    expect(manager.getServerFeatures('docs')).toEqual({
      tools: true,
      resources: true,
      prompts: false
    });
  });

  it('does not ask servers without resources or prompts', async () => {
    const listResources = vi.fn();
    const listPrompts = vi.fn();
    const manager = managerWith({
      getServerCapabilities: () => ({ tools: {} }),
      listResources,
      listPrompts
    });
    await expect(manager.listResources('docs')).resolves.toEqual([]);
    await expect(manager.listPrompts('docs')).resolves.toEqual([]);
    expect(listResources).not.toHaveBeenCalled();
    expect(listPrompts).not.toHaveBeenCalled();
  });

  it('follows resource pagination and keeps only descriptive fields', async () => {
    const listResources = vi
      .fn()
      .mockResolvedValueOnce({
        resources: [{ uri: 'docs://a', name: 'a', mimeType: 'text/markdown', extra: 1 }],
        nextCursor: 'page-2'
      })
      .mockResolvedValueOnce({ resources: [{ uri: 'docs://b', name: 'b', description: 'B' }] });
    const manager = managerWith({
      getServerCapabilities: () => ({ resources: {} }),
      listResources
    });
    await expect(manager.listResources('docs')).resolves.toEqual([
      { uri: 'docs://a', name: 'a', mimeType: 'text/markdown' },
      { uri: 'docs://b', name: 'b', description: 'B' }
    ]);
    expect(listResources).toHaveBeenNthCalledWith(2, { cursor: 'page-2' }, { signal: undefined });
  });

  it('follows template pagination and keeps catalog sections available when another list fails', async () => {
    const listResourceTemplates = vi
      .fn()
      .mockResolvedValueOnce({
        resourceTemplates: [{ name: 'Page', uriTemplate: 'docs://pages/{id}', extra: true }],
        nextCursor: 'page-2'
      })
      .mockResolvedValueOnce({
        resourceTemplates: [
          { name: 'Logo', uriTemplate: 'docs://logos/{id}', mimeType: 'image/png' }
        ]
      });
    const listPrompts = vi.fn();
    const manager = managerWith({
      getServerCapabilities: () => ({ resources: {} }),
      listResources: vi.fn().mockRejectedValue(new Error('unavailable')),
      listResourceTemplates,
      listPrompts
    });
    await expect(manager.listCatalog('docs')).resolves.toEqual({
      resources: { status: 'error', message: expect.stringContaining('unavailable') },
      resourceTemplates: {
        status: 'ready',
        items: [
          { name: 'Page', uriTemplate: 'docs://pages/{id}' },
          { name: 'Logo', uriTemplate: 'docs://logos/{id}', mimeType: 'image/png' }
        ]
      },
      prompts: { status: 'unsupported' }
    });
    expect(listResourceTemplates).toHaveBeenNthCalledWith(
      2,
      { cursor: 'page-2' },
      { signal: undefined }
    );
    expect(listPrompts).not.toHaveBeenCalled();
  });

  it('returns text content and reports binary content by size only', async () => {
    const manager = managerWith({
      readResource: vi.fn().mockResolvedValue({
        contents: [
          { uri: 'docs://a', mimeType: 'text/plain', text: 'hello' },
          { uri: 'docs://logo', mimeType: 'image/png', blob: 'YQ==' }
        ]
      })
    });
    await expect(manager.readResource('docs', 'docs://a')).resolves.toEqual([
      { uri: 'docs://a', mimeType: 'text/plain', text: 'hello' },
      { uri: 'docs://logo', mimeType: 'image/png', blobBytes: 1 }
    ]);
  });

  it('flattens prompt messages to text and passes prompt arguments', async () => {
    const getPrompt = vi.fn().mockResolvedValue({
      description: 'Review',
      messages: [
        { role: 'user', content: { type: 'text', text: 'Review this' } },
        { role: 'user', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } }
      ]
    });
    const manager = managerWith({ getPrompt });
    await expect(manager.getPrompt('docs', 'review', { topic: 'tags' })).resolves.toEqual({
      description: 'Review',
      messages: [
        { role: 'user', text: 'Review this' },
        { role: 'user', text: '[image content omitted]' }
      ]
    });
    expect(getPrompt).toHaveBeenCalledWith(
      { name: 'review', arguments: { topic: 'tags' } },
      { signal: undefined }
    );
  });

  it('names the server and resource when a read fails', async () => {
    const manager = managerWith({
      readResource: vi.fn().mockRejectedValue(new Error('not found'))
    });
    await expect(manager.readResource('docs', 'docs://missing')).rejects.toThrow(
      "Failed to read resource 'docs://missing' on server 'docs'"
    );
  });
});
