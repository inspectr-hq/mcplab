import { describe, expect, it } from 'vitest';
import { resourceMetadataCandidates } from './oauth-debugger-domain.js';

describe('resourceMetadataCandidates', () => {
  it('tries the path-specific protected-resource endpoint before the root fallback', () => {
    expect(resourceMetadataCandidates('https://mcp.example.com/mcp')).toEqual([
      'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
      'https://mcp.example.com/.well-known/oauth-protected-resource'
    ]);
  });

  it('does not duplicate the root endpoint for a root MCP URL', () => {
    expect(resourceMetadataCandidates('https://mcp.example.com/')).toEqual([
      'https://mcp.example.com/.well-known/oauth-protected-resource'
    ]);
  });
});
