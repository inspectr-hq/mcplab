import { describe, expect, it } from 'vitest';
import {
  authorizationServerMetadataCandidates,
  resourceMetadataCandidates
} from './oauth-debugger-domain.js';

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

describe('authorizationServerMetadataCandidates', () => {
  it('tries every advertised authorization server before falling back', () => {
    expect(
      authorizationServerMetadataCandidates([
        'https://auth.unavailable.example',
        'https://auth.available.example'
      ])
    ).toEqual([
      'https://auth.unavailable.example/.well-known/openid-configuration',
      'https://auth.unavailable.example/.well-known/oauth-authorization-server',
      'https://auth.available.example/.well-known/openid-configuration',
      'https://auth.available.example/.well-known/oauth-authorization-server'
    ]);
  });
});
