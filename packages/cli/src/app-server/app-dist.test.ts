import { describe, expect, it } from 'vitest';
import { resolveAppDist } from './app-dist.js';

describe('resolveAppDist', () => {
  it('prefers the repo-local app dist when it exists', () => {
    const result = resolveAppDist('/workspace', {
      existsSync: (path) => path === '/workspace/packages/app/dist',
      moduleUrl: 'file:///mock/router.js'
    });

    expect(result).toBe('/workspace/packages/app/dist');
  });

  it('falls back to the packaged cli app dist when repo dist is missing', () => {
    const result = resolveAppDist('/workspace', {
      existsSync: () => false,
      moduleUrl: 'file:///opt/mcplab/dist/app-server/router.js'
    });

    expect(result).toBe('/opt/mcplab/dist/app');
  });
});
