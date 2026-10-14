import { AgentConnectionError } from './agent-errors.js';
import { readEnvironmentVariable } from './environment.js';

export const AZURE_FOUNDRY_API_KEY_ENVS = [
  'AZURE_FOUNDRY_API_KEY',
  'AZURE_OPENAI_API_KEY'
] as const;

export function resolveAzureFoundryConnection(): { endpoint: string; apiKey: string } {
  const endpoint = readEnvironmentVariable('AZURE_FOUNDRY_ENDPOINT');
  if (!endpoint)
    throw new AgentConnectionError(
      'missing_credentials',
      'Missing AZURE_FOUNDRY_ENDPOINT. Set the Foundry resource endpoint.'
    );
  const apiKey = readEnvironmentVariable(AZURE_FOUNDRY_API_KEY_ENVS);
  if (!apiKey)
    throw new AgentConnectionError(
      'missing_credentials',
      'Missing AZURE_FOUNDRY_API_KEY or AZURE_OPENAI_API_KEY. Set a key for the Foundry resource.'
    );
  const url = new URL(endpoint);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'AZURE_FOUNDRY_ENDPOINT must be an HTTP or HTTPS resource endpoint without credentials, query, or fragment.'
    );
  }
  return { endpoint: url.toString().replace(/\/+$/, ''), apiKey };
}
