import { describe, expect, it } from 'vitest';
import { validateServerAuthConfig } from './server-auth-validation';

describe('validateServerAuthConfig', () => {
  it('requires bearer auth value', () => {
    expect(
      validateServerAuthConfig({
        id: 'bearer-server',
        name: 'Bearer Server',
        authType: 'bearer',
        authValue: '   '
      })
    ).toContain('bearer token is required');
  });

  it('requires API key value for direct api-key mode', () => {
    expect(
      validateServerAuthConfig({
        id: 'api-server',
        name: 'API Server',
        authType: 'api-key',
        authValue: '   '
      })
    ).toContain('API key value is required');
  });

  it('allows api-key auth without authValue when oauth client credentials is configured', () => {
    expect(
      validateServerAuthConfig({
        id: 'oauth-server',
        name: 'OAuth Server',
        authType: 'api-key',
        authValue: '   ',
        oauthTokenUrl: 'https://auth.example.com/token'
      })
    ).toBeNull();
  });
});
