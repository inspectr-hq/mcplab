import type { EvaluationDecisionConfig } from './types.js';

export const DECISION_PROVIDERS = {
  openai: {
    label: 'OpenAI Decisions',
    defaultModel: 'gpt-6-luna',
    models: ['gpt-6-luna'],
    editableModel: false,
    credentials: 'Requires OPENAI_API_KEY on the MCPLab backend.'
  },
  cloudflare: {
    label: 'Cloudflare Clef',
    defaultModel: 'clef-flash',
    models: ['clef-flash', 'clef'],
    editableModel: false,
    credentials: 'Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AUTH_TOKEN on the MCPLab backend.'
  },
  typesafe: {
    label: 'TypeSafe Jev',
    defaultModel: 'jev-1.13.0',
    models: ['jev-1.13.0'],
    editableModel: true,
    credentials: 'Requires TYPESAFE_API_KEY on the MCPLab backend.'
  },
  ollama: {
    label: 'Ollama',
    defaultModel: 'clef-flash',
    models: ['clef-flash', 'clef', 'nimble', 'tev1'],
    editableModel: true,
    credentials:
      'Requests use the MCPLab backend. Install a supported decision model on your Ollama server; models are not downloaded automatically.'
  }
} as const satisfies Record<
  EvaluationDecisionConfig['provider'],
  {
    label: string;
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

/** Shared validation for workspace settings and the settings form. */
export function normalizeEvaluationDecisionConfig(raw: unknown): EvaluationDecisionConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Decision engine configuration must be an object.');
  }
  const value = raw as Record<string, unknown>;
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
  return { provider, model, passThreshold, failThreshold, ...(baseUrl ? { baseUrl } : {}) };
}
