import type { ServerConfig } from '@/types/eval';

export function validateServerAuthConfig(
  server: Pick<ServerConfig, 'id' | 'name' | 'authType' | 'authValue' | 'oauthTokenUrl'>
): string | null {
  const serverLabel = server.name?.trim() || server.id || 'Server';
  const authValue = server.authValue?.trim() || '';
  const oauthTokenUrl = server.oauthTokenUrl?.trim() || '';

  if (server.authType === 'bearer' && authValue.length === 0) {
    return `${serverLabel}: bearer token is required.`;
  }

  if (server.authType === 'api-key' && oauthTokenUrl.length === 0 && authValue.length === 0) {
    return `${serverLabel}: API key value is required.`;
  }

  return null;
}
