import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAzureOpenAIDeploymentSuggestions,
  resolveAzureOpenAIDeployment
} from './azure-config.js';

afterEach(() => vi.unstubAllEnvs());

describe('Azure OpenAI deployments', () => {
  it('collects configured deployment suggestions from all supported environment variables', () => {
    vi.stubEnv(
      'AZURE_OPENAI_DEPLOYMENTS',
      ' custom-deployment,global-deployment,custom-deployment '
    );
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'global-deployment');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT_NAME', 'named-deployment');

    expect(getAzureOpenAIDeploymentSuggestions()).toEqual([
      'custom-deployment',
      'global-deployment',
      'named-deployment'
    ]);
  });

  it('uses an agent deployment only when it matches configured deployment suggestions', () => {
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENTS', 'actual-deployment');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'fallback-deployment');

    expect(resolveAzureOpenAIDeployment(' actual-deployment ')).toBe('actual-deployment');
    expect(resolveAzureOpenAIDeployment('gpt-4o')).toBe('fallback-deployment');
  });

  it('uses the legacy deployment when the agent has no model', () => {
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'fallback-deployment');

    expect(resolveAzureOpenAIDeployment('  ')).toBe('fallback-deployment');
  });
});
