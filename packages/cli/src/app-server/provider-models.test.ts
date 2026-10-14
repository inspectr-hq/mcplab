import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchProviderModels } from './provider-models.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('configured Azure deployments', () => {
  it('reports Foundry suggestions as environment configuration without claiming connectivity', async () => {
    vi.stubEnv(
      'AZURE_FOUNDRY_DEPLOYMENTS',
      'second-deployment, first-deployment, second-deployment'
    );
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await fetchProviderModels('azure_foundry')).toEqual({
      provider: 'azure_foundry',
      items: ['first-deployment', 'second-deployment'],
      kind: 'deployments',
      source: 'AZURE_FOUNDRY_DEPLOYMENTS environment variable'
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('allows manual deployment entry without configured suggestions', async () => {
    vi.stubEnv('AZURE_FOUNDRY_DEPLOYMENTS', '');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'unrelated-deployment');
    expect((await fetchProviderModels('azure_foundry')).items).toEqual([]);
  });
});
