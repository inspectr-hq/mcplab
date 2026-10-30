const providerLabels: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  azure: 'Azure OpenAI',
  azure_openai: 'Azure OpenAI',
  azure_foundry: 'Azure Foundry',
  google: 'Google'
};

export function formatProvider(provider: string): string {
  return providerLabels[provider] ?? provider;
}
