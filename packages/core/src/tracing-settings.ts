import { isLangSmithEnabled } from './langsmith-tracing.js';
import { isLangfuseEnabled } from './langfuse-tracing.js';
import type { EvaluationTracingIntegration, EvaluationTracingSettings } from './types.js';

/** Public configuration only. Credentials stay in the server environment. */
export function getEvaluationTracingSettings(
  env: Record<string, string | undefined> = process.env
): EvaluationTracingSettings {
  const tracingIntegrations: EvaluationTracingIntegration[] = [];
  if (isLangSmithEnabled(env)) {
    tracingIntegrations.push({
      provider: 'langsmith',
      endpoint: publicEndpoint(env.LANGSMITH_ENDPOINT?.trim() || 'https://api.smith.langchain.com'),
      project: env.LANGSMITH_PROJECT?.trim() || 'default'
    });
  }
  if (isLangfuseEnabled(env)) {
    tracingIntegrations.push({
      provider: 'langfuse',
      endpoint: publicEndpoint(env.LANGFUSE_BASE_URL?.trim() || 'https://cloud.langfuse.com')
    });
  }
  return { tracingIntegrations };
}

function publicEndpoint(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
}
