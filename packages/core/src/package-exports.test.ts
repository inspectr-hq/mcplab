import { describe, expect, it } from 'vitest';
import packageJson from '../package.json';

describe('package browser exports', () => {
  it('keeps browser and Node type declarations aligned with their runtime entries', () => {
    expect(packageJson.exports['.']).toEqual({
      browser: { types: './dist/browser.d.ts', default: './dist/browser.js' },
      import: { types: './dist/index.d.ts', default: './dist/index.js' },
      require: { types: './dist/index.d.ts', default: './dist/index.js' },
      default: { types: './dist/index.d.ts', default: './dist/index.js' }
    });
  });
});
