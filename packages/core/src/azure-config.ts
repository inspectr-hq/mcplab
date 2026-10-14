export const AZURE_FOUNDRY_API_KEY_ENVS = [
  'AZURE_FOUNDRY_API_KEY',
  'AZURE_OPENAI_API_KEY'
] as const;

/** Ordered aliases allow deployments on the same Azure resource to share a backend key. */
export function readEnvironmentVariable(names: string | readonly string[]): string | undefined {
  for (const name of typeof names === 'string' ? [names] : names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function resolveAzureFoundryConnection(): { endpoint: string; apiKey: string } {
  const endpoint = readEnvironmentVariable('AZURE_FOUNDRY_ENDPOINT');
  if (!endpoint)
    throw new Error('Missing AZURE_FOUNDRY_ENDPOINT. Set the Foundry resource endpoint.');
  const apiKey = readEnvironmentVariable(AZURE_FOUNDRY_API_KEY_ENVS);
  if (!apiKey)
    throw new Error(
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
