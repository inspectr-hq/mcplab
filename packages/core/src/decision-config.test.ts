import { describe, expect, it } from 'vitest';
import {
  DECISION_DEFAULTS,
  DECISION_PROVIDERS,
  normalizeEvaluationDecisionConfig
} from './decision-config.js';

describe('decision provider configuration', () => {
  it.each(['openai', 'cloudflare', 'typesafe', 'ollama'] as const)(
    'accepts the advertised %s default with shared threshold defaults',
    (provider) => {
      const config = normalizeEvaluationDecisionConfig({
        provider,
        model: DECISION_PROVIDERS[provider].defaultModel
      });
      expect(config).toMatchObject({
        provider,
        passThreshold: DECISION_DEFAULTS.passThreshold,
        failThreshold: DECISION_DEFAULTS.failThreshold
      });
      if (provider === 'ollama') expect(config.baseUrl).toBe(DECISION_DEFAULTS.baseUrl);
      else expect(config.baseUrl).toBeUndefined();
    }
  );

  it.each(['openai', 'cloudflare'] as const)('rejects arbitrary models for %s', (provider) => {
    expect(() => normalizeEvaluationDecisionConfig({ provider, model: 'custom-model' })).toThrow();
  });

  it.each(['typesafe', 'ollama'] as const)('accepts custom models for %s', (provider) => {
    expect(normalizeEvaluationDecisionConfig({ provider, model: ' custom-model ' }).model).toBe(
      'custom-model'
    );
  });

  it.each(['toString', '__proto__', 'constructor'])(
    'rejects inherited registry key %s',
    (provider) => {
      expect(() => normalizeEvaluationDecisionConfig({ provider, model: 'custom-model' })).toThrow(
        'Choose a supported'
      );
    }
  );
});
