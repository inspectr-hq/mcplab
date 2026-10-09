import { expect, it } from 'vitest';
import {
  DEFAULT_BROWSER_PROVIDER_PROFILES,
  mergeBrowserProviderProfiles
} from './default-browser-providers.js';

it('lets workspace profiles override defaults without mutating built-ins', () => {
  const custom = {
    ...structuredClone(DEFAULT_BROWSER_PROVIDER_PROFILES.claude),
    name: 'Workspace Claude',
    source: 'workspace' as const
  };
  const merged = mergeBrowserProviderProfiles({
    claude: custom,
    constructor: { ...custom, id: 'constructor' }
  });
  expect(merged.claude).toBe(custom);
  expect(merged.constructor.id).toBe('constructor');
  merged['chatgpt-com'].name = 'Changed';
  expect(DEFAULT_BROWSER_PROVIDER_PROFILES['chatgpt-com'].name).not.toBe('Changed');
  expect(DEFAULT_BROWSER_PROVIDER_PROFILES.claude.name).toBe('Claude');
});
