import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseBrowserProviderProfiles, type BrowserProviderProfile } from './browser-providers.js';

export function readBrowserProviderProfiles(
  bundleRoot: string,
  options: { strict?: boolean } = {}
): Record<string, BrowserProviderProfile> {
  const directory = join(bundleRoot, 'browser-providers');
  if (!existsSync(directory)) return {};
  const profiles: Record<string, BrowserProviderProfile> = {};
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    const id = basename(file, extname(file));
    const path = join(directory, file);
    const raw = readFileSync(path, 'utf8');
    let profile: BrowserProviderProfile;
    try {
      profile = parseBrowserProviderProfiles({ [id]: parseYaml(raw) })[id];
    } catch (error) {
      if (options.strict) {
        throw new Error(
          `Invalid browser provider file ${path}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        );
      }
      // One malformed YAML or invalid profile must not hide the rest of the library.
      // Filesystem errors remain outside this catch so callers can report them.
      continue;
    }
    const stats = statSync(path);
    profiles[id] = {
      ...profile,
      source: 'workspace',
      learned: {
        ...profile.learned,
        createdAt: new Date(stats.birthtimeMs || stats.ctimeMs).toISOString(),
        updatedAt: new Date(stats.mtimeMs).toISOString()
      }
    };
  }
  return profiles;
}
