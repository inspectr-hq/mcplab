export interface ProviderModelsResponse {
  provider: 'anthropic' | 'openai' | 'azure';
  items: string[];
  kind: 'models' | 'deployments';
  source: string;
}

export async function fetchProviderModels(provider: string): Promise<ProviderModelsResponse> {
  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    const response = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Anthropic model discovery failed (${response.status}): ${text}`);
    }
    const parsed = JSON.parse(text) as { data?: Array<{ id?: string }> };
    const items = (parsed.data ?? [])
      .map((item) => String(item.id ?? '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return { provider: 'anthropic', items, kind: 'models', source: 'anthropic /v1/models' };
  }

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI model discovery failed (${response.status}): ${text}`);
    }
    const parsed = JSON.parse(text) as { data?: Array<{ id?: string }> };
    const items = (parsed.data ?? [])
      .map((item) => String(item.id ?? '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return { provider: 'openai', items, kind: 'models', source: 'openai /v1/models' };
  }

  if (provider === 'azure') {
    const envCandidates = [
      process.env.AZURE_OPENAI_DEPLOYMENTS,
      process.env.AZURE_OPENAI_DEPLOYMENT,
      process.env.AZURE_OPENAI_DEPLOYMENT_NAME
    ]
      .flatMap((value) => (value ?? '').split(','))
      .map((item) => item.trim())
      .filter(Boolean);
    const items = Array.from(new Set(envCandidates)).sort((a, b) => a.localeCompare(b));
    if (items.length === 0) {
      throw new Error(
        'Azure OpenAI discovery uses deployment names. Set AZURE_OPENAI_DEPLOYMENTS (comma-separated) or AZURE_OPENAI_DEPLOYMENT.'
      );
    }
    return { provider: 'azure', items, kind: 'deployments', source: 'environment variables' };
  }

  throw new Error(`Unsupported provider for model discovery: ${provider}`);
}
