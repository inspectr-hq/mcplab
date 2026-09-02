import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfigValue } from './config-values.js';

describe('resolveConfigValue', () => {
  afterEach(() => {
    delete process.env.MCPLAB_TEST_SECRET;
  });

  it('resolves complete environment placeholders', () => {
    process.env.MCPLAB_TEST_SECRET = 'resolved-secret';
    expect(resolveConfigValue('${MCPLAB_TEST_SECRET}', 'OAuth client_secret')).toBe(
      'resolved-secret'
    );
  });

  it('preserves literal values', () => {
    expect(resolveConfigValue('literal-secret', 'OAuth client_secret')).toBe('literal-secret');
  });

  it('throws when a referenced environment variable is missing', () => {
    expect(() => resolveConfigValue('${MCPLAB_TEST_SECRET}', 'OAuth client_secret')).toThrow(
      "Missing env var 'MCPLAB_TEST_SECRET' for OAuth client_secret"
    );
  });
});
