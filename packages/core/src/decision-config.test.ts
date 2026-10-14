import { describe, expect, it } from 'vitest';
import {
  DECISION_DEFAULTS,
  DECISION_PROVIDERS,
  isDecisionEngineEnabled,
  normalizeEvaluationDecisionConfig
} from './decision-config.js';

describe('decision provider configuration', () => {
  it.each([
    [undefined, false],
    [null, false],
    [{ provider: 'openai', model: 'gpt-6-luna' }, true],
    [{ provider: 'openai', model: 'gpt-6-luna', enabled: true }, true],
    [{ provider: 'openai', model: 'gpt-6-luna', enabled: false }, false]
  ])('resolves whether a configured decision engine is enabled', (config, expected) => {
    expect(isDecisionEngineEnabled(config as Parameters<typeof isDecisionEngineEnabled>[0])).toBe(
      expected
    );
  });
  it('preserves an explicit enabled flag and keeps legacy configurations enabled by default', () => {
    const raw = { provider: 'openai', model: 'gpt-6-luna' };
    expect(normalizeEvaluationDecisionConfig({ ...raw, enabled: false }).enabled).toBe(false);
    expect(normalizeEvaluationDecisionConfig({ ...raw, enabled: true }).enabled).toBe(true);
    expect(normalizeEvaluationDecisionConfig(raw).enabled).toBeUndefined();
  });
  it.each(['false', 0, null])('rejects a non-boolean enabled flag %j', (enabled) => {
    expect(() =>
      normalizeEvaluationDecisionConfig({ provider: 'openai', model: 'gpt-6-luna', enabled })
    ).toThrow('boolean');
  });
  it.each(['openai', 'cloudflare', 'typesafe', 'ollama', 'azure_foundry'] as const)(
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

  it.each(['typesafe', 'ollama', 'azure_foundry'] as const)(
    'accepts custom models for %s',
    (provider) => {
      expect(normalizeEvaluationDecisionConfig({ provider, model: ' custom-model ' }).model).toBe(
        'custom-model'
      );
    }
  );

  it.each(['toString', '__proto__', 'constructor'])(
    'rejects inherited registry key %s',
    (provider) => {
      expect(() => normalizeEvaluationDecisionConfig({ provider, model: 'custom-model' })).toThrow(
        'Choose a supported'
      );
    }
  );
});
