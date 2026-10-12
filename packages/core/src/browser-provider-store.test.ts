import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_BROWSER_PROVIDER_PROFILES } from './default-browser-providers.js';
import { serializeBrowserProviderProfile } from './browser-providers.js';
import { readBrowserProviderProfiles } from './browser-provider-store.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('readBrowserProviderProfiles', () => {
  it('skips invalid individual profiles while loading valid profiles with file metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-provider-store-'));
    roots.push(root);
    expect(readBrowserProviderProfiles(root)).toEqual({});
    const directory = join(root, 'browser-providers');
    mkdirSync(directory);
    writeFileSync(join(directory, 'bad-yaml.yaml'), 'name: [');
    writeFileSync(join(directory, 'bad-schema.yml'), 'name: Missing required fields');
    writeFileSync(join(directory, 'ignored.txt'), 'name: [');
    const validPath = join(directory, 'custom-chat.yml');
    writeFileSync(
      validPath,
      serializeBrowserProviderProfile(DEFAULT_BROWSER_PROVIDER_PROFILES.claude)
    );
    const stats = statSync(validPath);

    const profiles = readBrowserProviderProfiles(root);
    expect(Object.keys(profiles)).toEqual(['custom-chat']);
    expect(profiles['custom-chat']).toMatchObject({
      id: 'custom-chat',
      source: 'workspace',
      learned: {
        createdAt: new Date(stats.birthtimeMs || stats.ctimeMs).toISOString(),
        updatedAt: new Date(stats.mtimeMs).toISOString()
      }
    });
  });

  it('does not hide filesystem errors', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-provider-store-'));
    roots.push(root);
    mkdirSync(join(root, 'browser-providers', 'directory.yaml'), { recursive: true });
    expect(() => readBrowserProviderProfiles(root)).toThrow();
  });

  it.each(['name: [', 'name: Missing required fields'])(
    'reports invalid profiles with their filename when strict reading is requested',
    (raw) => {
      const root = mkdtempSync(join(tmpdir(), 'mcplab-provider-store-'));
      roots.push(root);
      const directory = join(root, 'browser-providers');
      mkdirSync(directory);
      writeFileSync(join(directory, 'broken.yaml'), raw);

      expect(() => readBrowserProviderProfiles(root, { strict: true })).toThrow(
        /Invalid browser provider file .*broken\.yaml: .+/
      );
    }
  );
});
