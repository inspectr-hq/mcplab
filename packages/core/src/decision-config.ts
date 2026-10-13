export interface EvaluationDecisionConfig {
  provider: 'openai' | 'cloudflare' | 'typesafe' | 'ollama';
  model: string;
  passThreshold: number;
  failThreshold: number;
  baseUrl?: string;
}

/** Shared validation for workspace settings and the settings form. */
export function normalizeEvaluationDecisionConfig(raw: unknown): EvaluationDecisionConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Decision engine configuration must be an object.');
  }
  const value = raw as Record<string, unknown>;
  const provider = value.provider;
  if (
    provider !== 'openai' &&
    provider !== 'cloudflare' &&
    provider !== 'typesafe' &&
    provider !== 'ollama'
  ) {
    throw new Error('Choose a supported decision engine provider.');
  }
  if (typeof value.model !== 'string' || !value.model.trim()) {
    throw new Error('Decision engine model is required.');
  }
  const model = value.model.trim();
  if (provider === 'openai' && model !== 'gpt-6-luna') {
    throw new Error('OpenAI Decisions currently supports gpt-6-luna.');
  }
  if (provider === 'cloudflare' && model !== 'clef' && model !== 'clef-flash') {
    throw new Error('Cloudflare decision model must be clef or clef-flash.');
  }
  const passThreshold = value.passThreshold === undefined ? 0.9 : value.passThreshold;
  const failThreshold = value.failThreshold === undefined ? 0.1 : value.failThreshold;
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
    const url = new URL((value.baseUrl as string | undefined)?.trim() || 'http://localhost:11434');
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
