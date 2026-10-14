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
  it('uses the same sorted, deduplicated deployment parsing and empty behavior for Azure', async () => {
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENTS', ' second,first,second ');
    expect(await fetchProviderModels('azure')).toMatchObject({
      items: ['first', 'second'],
      kind: 'deployments'
    });
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENTS', '');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', '');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT_NAME', '');
    expect((await fetchProviderModels('azure')).items).toEqual([]);
  });
  it('allows manual deployment entry without configured suggestions', async () => {
    vi.stubEnv('AZURE_FOUNDRY_DEPLOYMENTS', '');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'unrelated-deployment');
    expect((await fetchProviderModels('azure_foundry')).items).toEqual([]);
  });
});
