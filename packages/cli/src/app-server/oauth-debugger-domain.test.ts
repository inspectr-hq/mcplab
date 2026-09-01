import { describe, expect, it } from 'vitest';
import { createOAuthDebuggerSession, resourceMetadataCandidates } from './oauth-debugger-domain.js';

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

  it('tries an advertised URL first, then inferred candidates if needed', () => {
    expect(
      resourceMetadataCandidates(
        'http://mcp.example.com/mcp',
        'http://mcp.example.com/.well-known/oauth-protected-resource'
      )
    ).toEqual([
      'http://mcp.example.com/.well-known/oauth-protected-resource',
      'http://mcp.example.com/.well-known/oauth-protected-resource/mcp'
    ]);
  });
});

describe('createOAuthDebuggerSession', () => {
  it('resolves environment placeholders in pre-registered OAuth credentials', () => {
    process.env.MCPLAB_TEST_OAUTH_CLIENT_ID = 'resolved-client';
    process.env.MCPLAB_TEST_OAUTH_SECRET = 'resolved-secret';
    try {
      const session = createOAuthDebuggerSession({
        config: {
          profile: 'latest',
          target: { serverName: 'oauth-server' },
          registrationMethod: 'pre_registered',
          clientConfig: { preRegistered: {} },
          runtime: { redirectMode: 'local_callback', usePkce: true, codeChallengeMethod: 'S256' },
          display: { showSensitiveValues: false }
        },
        serverConfig: {
          transport: 'http',
          url: 'https://example.com/mcp',
          auth: {
            type: 'oauth_authorization_code',
            client_id: '${MCPLAB_TEST_OAUTH_CLIENT_ID}',
            client_secret: '${MCPLAB_TEST_OAUTH_SECRET}'
          }
        } as any
      });

      expect(session.config.clientConfig).toEqual({
        preRegistered: { clientId: 'resolved-client', clientSecret: 'resolved-secret' }
      });
    } finally {
      delete process.env.MCPLAB_TEST_OAUTH_SECRET;
      delete process.env.MCPLAB_TEST_OAUTH_CLIENT_ID;
    }
  });
});
