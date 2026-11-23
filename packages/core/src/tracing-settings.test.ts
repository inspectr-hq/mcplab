import { describe, expect, it } from 'vitest';
import { getEvaluationTracingSettings } from './tracing-settings.js';

describe('evaluation tracing settings', () => {
  it('omits disabled and incompletely configured integrations', () => {
    expect(getEvaluationTracingSettings({})).toEqual({ tracingIntegrations: [] });
    expect(
      getEvaluationTracingSettings({
        LANGSMITH_TRACING: 'true',
        LANGFUSE_TRACING: 'true',
        LANGFUSE_PUBLIC_KEY: 'public'
      })
    ).toEqual({ tracingIntegrations: [] });
  });

  it('returns public destination details for both enabled integrations', () => {
    expect(
      getEvaluationTracingSettings({
        LANGSMITH_TRACING: ' TRUE ',
        LANGSMITH_API_KEY: 'secret-smith',
        LANGSMITH_PROJECT: ' mcplab ',
        LANGSMITH_ENDPOINT: 'https://eu.api.smith.langchain.com',
        LANGFUSE_TRACING: 'true',
        LANGFUSE_PUBLIC_KEY: 'public-fuse',
        LANGFUSE_SECRET_KEY: 'secret-fuse',
        LANGFUSE_BASE_URL: 'https://user:password@self-hosted.test/langfuse/?token=private#private'
      })
    ).toEqual({
      tracingIntegrations: [
        {
          provider: 'langsmith',
          endpoint: 'https://eu.api.smith.langchain.com',
          project: 'mcplab'
        },
        { provider: 'langfuse', endpoint: 'https://self-hosted.test/langfuse' }
      ]
    });
  });

  it('uses the exporter defaults and never returns an invalid raw endpoint', () => {
    const env = {
      LANGSMITH_TRACING: 'true',
      LANGSMITH_API_KEY: 'secret',
      LANGFUSE_TRACING: 'true',
      LANGFUSE_PUBLIC_KEY: 'public',
      LANGFUSE_SECRET_KEY: 'secret'
    };
    expect(getEvaluationTracingSettings(env).tracingIntegrations).toEqual([
      { provider: 'langsmith', endpoint: 'https://api.smith.langchain.com', project: 'default' },
      { provider: 'langfuse', endpoint: 'https://cloud.langfuse.com' }
    ]);
    expect(
      getEvaluationTracingSettings({ ...env, LANGFUSE_BASE_URL: 'invalid-private-value' })
        .tracingIntegrations?.[1].endpoint
    ).toBeUndefined();
  });
});
