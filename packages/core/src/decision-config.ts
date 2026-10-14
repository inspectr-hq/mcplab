import type { EvaluationDecisionConfig } from './types.js';

export const DECISION_PROVIDERS = {
  openai: {
    label: 'OpenAI Decisions',
    modelLabel: 'Decision model',
    defaultModel: 'gpt-6-luna',
    models: ['gpt-6-luna'],
    editableModel: false,
    credentials: 'Requires OPENAI_API_KEY on the MCPLab backend.'
  },
  cloudflare: {
    label: 'Cloudflare Clef',
    modelLabel: 'Decision model',
    defaultModel: 'clef-flash',
    models: ['clef-flash', 'clef'],
    editableModel: false,
    credentials: 'Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_TOKEN on the MCPLab backend.'
  },
  typesafe: {
    label: 'TypeSafe Jev',
    modelLabel: 'Decision model',
    defaultModel: 'jev-1.13.0',
    models: ['jev-1.13.0'],
    editableModel: true,
    credentials: 'Requires TYPESAFE_API_KEY on the MCPLab backend.'
  },
  ollama: {
    label: 'Ollama',
    modelLabel: 'Ollama model name',
    defaultModel: 'clef-flash',
    models: ['clef-flash', 'clef', 'nimble', 'tev1:4b', 'tev1:0.8b'],
    editableModel: true,
    credentials:
      'Requests use the MCPLab backend. Install a supported decision model on your Ollama server; models are not downloaded automatically.'
  },
  azure_foundry: {
    label: 'Azure Foundry',
    modelLabel: 'Deployment name',
    defaultModel: 'Microsoft-Decision-1',
    models: ['Microsoft-Decision-1'],
    editableModel: true,
    credentials:
      'Requires AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_API_KEY (or AZURE_OPENAI_API_KEY for the same resource) on the MCPLab backend. Enter the name of your Microsoft-Decision-1 deployment, which may differ from the model name. Use the Foundry resource endpoint, not the project endpoint.'
  }
} as const satisfies Record<
  EvaluationDecisionConfig['provider'],
  {
    label: string;
    modelLabel: string;
    defaultModel: string;
    models: readonly string[];
    editableModel: boolean;
    credentials: string;
  }
>;

export const DECISION_DEFAULTS = {
  passThreshold: 0.9,
  failThreshold: 0.1,
  baseUrl: 'http://localhost:11434'
} as const;

export function isDecisionEngineEnabled<
  T extends Pick<EvaluationDecisionConfig, 'enabled'> | null | undefined
>(config: T): config is NonNullable<T> {
  return Boolean(config) && config?.enabled !== false;
}

/** Shared validation for workspace settings and the settings form. */
export function normalizeEvaluationDecisionConfig(raw: unknown): EvaluationDecisionConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Decision engine configuration must be an object.');
  }
  const value = raw as Record<string, unknown>;
  const enabled = value.enabled;
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new Error('Decision engine enabled must be a boolean.');
  }
  const rawProvider = value.provider;
  if (typeof rawProvider !== 'string' || !Object.hasOwn(DECISION_PROVIDERS, rawProvider)) {
    throw new Error('Choose a supported decision engine provider.');
  }
  const provider = rawProvider as EvaluationDecisionConfig['provider'];
  const definition = DECISION_PROVIDERS[provider];
  if (typeof value.model !== 'string' || !value.model.trim()) {
    throw new Error('Decision engine model is required.');
  }
  const model = value.model.trim();
  if (!definition.editableModel && !(definition.models as readonly string[]).includes(model)) {
    throw new Error(`${definition.label} supports ${definition.models.join(' or ')}.`);
  }
  const passThreshold =
    value.passThreshold === undefined ? DECISION_DEFAULTS.passThreshold : value.passThreshold;
  const failThreshold =
    value.failThreshold === undefined ? DECISION_DEFAULTS.failThreshold : value.failThreshold;
  if (
    typeof passThreshold !== 'number' ||
    typeof failThreshold !== 'number' ||
    !Number.isFinite(passThreshold) ||
    !Number.isFinite(failThreshold) ||
    failThreshold < 0 ||
    failThreshold >= passThreshold ||
    passThreshold > 1
  ) {
    throw new Error(
      'Decision thresholds must satisfy 0 ≤ fail probability < pass probability ≤ 1.'
    );
  }
  if (provider !== 'ollama' && value.baseUrl !== undefined) {
    throw new Error('A server URL can only be configured for Ollama.');
  }
  let baseUrl: string | undefined;
  if (provider === 'ollama') {
    if (value.baseUrl !== undefined && typeof value.baseUrl !== 'string') {
      throw new Error('Ollama server URL must be a string.');
    }
    const url = new URL((value.baseUrl as string | undefined)?.trim() || DECISION_DEFAULTS.baseUrl);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'Ollama server URL must be HTTP or HTTPS without credentials, query, or fragment.'
      );
    }
    baseUrl = url.toString().replace(/\/+$/, '');
  }
  return {
    provider,
    model,
    passThreshold,
    failThreshold,
    ...(baseUrl ? { baseUrl } : {}),
    ...(enabled !== undefined ? { enabled } : {})
  };
}
