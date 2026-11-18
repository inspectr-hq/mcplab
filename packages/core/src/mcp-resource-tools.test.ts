import { describe, expect, it } from 'vitest';
import {
  getMcpResourceToolAccess,
  parseMcpResourceToolCatalog,
  parseMcpResourceToolRead
} from './mcp-resource-tools.js';

describe('resource tools', () => {
  it('recognizes resource tools with a callable schema', () => {
    const list = { name: 'list_resources', inputSchema: { type: 'object' } };
    const read = {
      name: 'read_resource',
      inputSchema: {
        type: 'object',
        properties: { resource_uri: { type: 'string' } },
        required: ['resource_uri']
      }
    };
    expect(getMcpResourceToolAccess([list, read])).toEqual({
      canList: true,
      readArgument: 'resource_uri'
    });
    expect(
      getMcpResourceToolAccess([{ ...list, inputSchema: { type: 'object', required: ['scope'] } }])
    ).toEqual({ canList: false, readArgument: undefined });
  });

  it('normalizes skill files and templates from a tool text response', () => {
    const catalog = parseMcpResourceToolCatalog({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            resources: [
              { name: 'Review', uri: 'skill://review/SKILL.md', mime_type: 'text/markdown' },
              { uri_template: 'docs://pages/{id}', description: 'A page' }
            ]
          })
        }
      ]
    });
    expect(catalog).toEqual({
      resources: [{ name: 'Review', uri: 'skill://review/SKILL.md', mimeType: 'text/markdown' }],
      resourceTemplates: [
        { name: 'docs://pages/{id}', uriTemplate: 'docs://pages/{id}', description: 'A page' }
      ]
    });
  });

  it('keeps typed binary resource reads as metadata and surfaces tool errors', () => {
    expect(
      parseMcpResourceToolRead('docs://image', {
        content: [{ type: 'image', data: 'YQ==', mimeType: 'image/png' }]
      })
    ).toEqual([{ uri: 'docs://image', blobBytes: 1, mimeType: 'image/png' }]);
    expect(() =>
      parseMcpResourceToolCatalog({
        isError: true,
        content: [{ type: 'text', text: 'Access denied' }]
      })
    ).toThrow('Access denied');
    expect(() => parseMcpResourceToolCatalog({ structuredContent: { unexpected: [] } })).toThrow(
      'resource entries'
    );
  });

  it('handles wrapped results and individual JSON text blocks', () => {
    const resource = { name: 'Guide', uri: 'docs://guide' };
    const second = { name: 'About', uri: 'docs://about' };
    expect(
      parseMcpResourceToolCatalog({ structuredContent: { result: [resource] } }).resources
    ).toEqual([resource]);
    expect(
      parseMcpResourceToolCatalog({
        content: [resource, second].map((entry) => ({ type: 'text', text: JSON.stringify(entry) }))
      }).resources
    ).toEqual([resource, second]);
    expect(
      parseMcpResourceToolRead('docs://guide', { structuredContent: { result: 'Guide content' } })
    ).toEqual([{ uri: 'docs://guide', text: 'Guide content' }]);
  });
});
