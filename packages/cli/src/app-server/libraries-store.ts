import { basename, extname, join, resolve } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  readFileSync
} from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { BrowserAgentConfig, BrowserProviderProfile, EvalConfig } from '@inspectr/mcplab-core';
import { parseBrowserProviderProfiles, readLibraryAgentsAndServers } from '@inspectr/mcplab-core';
import { ensureInsideRoot, safeFileName } from './store-utils.js';

const TEST_CASES_DIR_NAME = 'test-cases';
const LEGACY_SCENARIOS_DIR_NAME = 'scenarios';

function readYamlFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = parseYaml(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function readLibraries(librariesDir: string): {
  servers: EvalConfig['servers'];
  agents: EvalConfig['agents'];
  scenarios: EvalConfig['scenarios'];
  browserProviders: Record<string, BrowserProviderProfile>;
} {
  const root = resolve(librariesDir);
  const { testCasesDir, legacyScenariosDir } = ensureTestCasesDir(root);
  const { servers, agents } = readLibraryAgentsAndServers(root);
  const scenarios: EvalConfig['scenarios'] = [];
  const sourceDir = existsSync(testCasesDir)
    ? testCasesDir
    : existsSync(legacyScenariosDir)
      ? legacyScenariosDir
      : null;
  if (sourceDir) {
    const files = readdirSync(sourceDir)
      .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
      .sort((a, b) => a.localeCompare(b));
    for (const file of files) {
      const scenarioPath = ensureInsideRoot(sourceDir, join(sourceDir, file));
      const parsed = readYamlFile<EvalConfig['scenarios'][number] | null>(scenarioPath, null);
      if (!parsed || typeof parsed !== 'object') continue;
      const id = String(parsed.id ?? basename(file, extname(file)));
      scenarios.push({ ...parsed, id });
    }
  }
  const browserProviders = parseBrowserProviderProfiles(
    readYamlFile<Record<string, unknown>>(join(root, 'browser-providers.yaml'), {})
  );
  return { servers, agents, scenarios, browserProviders };
}

export function writeBrowserProviderProfiles(
  librariesDir: string,
  profiles: Record<string, BrowserProviderProfile>
): void {
  const root = resolve(librariesDir);
  mkdirSync(root, { recursive: true });
  const target = join(root, 'browser-providers.yaml');
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  const yamlProfiles = Object.fromEntries(
    Object.entries(profiles).map(([id, profile]) => [
      id,
      {
        schema_version: profile.schemaVersion,
        name: profile.name,
        match: profile.match,
        composer: {
          locator: profile.composer.locator,
          input_mode: profile.composer.inputMode
        },
        submit: profile.submit,
        assistant_messages: {
          locator: profile.assistantMessages.locator,
          text_locator: profile.assistantMessages.textLocator
        },
        completion: {
          generating_locator: profile.completion.generatingLocator,
          idle_locator: profile.completion.idleLocator,
          stability_ms: profile.completion.stabilityMs
        },
        new_conversation: profile.newConversation,
        learned: {
          source_origin: profile.learned.sourceOrigin,
          created_at: profile.learned.createdAt,
          updated_at: profile.learned.updatedAt,
          confidence: profile.learned.confidence
        }
      }
    ])
  );
  writeFileSync(temporary, `${stringifyYaml(yamlProfiles)}\n`, 'utf8');
  renameSync(temporary, target);
}

export function writeBrowserProviderAndAgent(
  librariesDir: string,
  profile: BrowserProviderProfile,
  agent: { id: string; name: string; provider: string; url: string }
): { profile: BrowserProviderProfile; agent: BrowserAgentConfig & { id: string } } {
  const current = readLibraries(librariesDir);
  const existingAgent = current.agents[agent.id];
  if (
    existingAgent &&
    (existingAgent.type !== 'browser' || existingAgent.provider !== profile.id)
  ) {
    throw new Error(`Agent '${agent.id}' already exists with a different configuration.`);
  }
  const existingProfile = current.browserProviders[profile.id];
  const storedProfile = existingProfile
    ? { ...profile, learned: { ...profile.learned, createdAt: existingProfile.learned.createdAt } }
    : profile;
  const browserAgent = {
    id: agent.id,
    type: 'browser' as const,
    name: agent.name,
    provider: profile.id,
    url: agent.url
  };
  writeBrowserProviderProfiles(librariesDir, {
    ...current.browserProviders,
    [profile.id]: storedProfile
  });
  writeLibraries(librariesDir, {
    servers: current.servers,
    agents: { ...current.agents, [agent.id]: browserAgent },
    scenarios: current.scenarios
  });
  return { profile: storedProfile, agent: browserAgent };
}

export function writeLibraries(
  librariesDir: string,
  libraries: {
    servers: EvalConfig['servers'];
    agents: EvalConfig['agents'];
    scenarios: EvalConfig['scenarios'];
    browserProviders?: Record<string, BrowserProviderProfile>;
  }
) {
  const root = resolve(librariesDir);
  const { testCasesDir } = ensureTestCasesDir(root);
  mkdirSync(root, { recursive: true });
  mkdirSync(testCasesDir, { recursive: true });

  writeFileSync(join(root, 'servers.yaml'), `${stringifyYaml(libraries.servers ?? {})}\n`, 'utf8');
  writeFileSync(join(root, 'agents.yaml'), `${stringifyYaml(libraries.agents ?? {})}\n`, 'utf8');
  if (libraries.browserProviders)
    writeBrowserProviderProfiles(librariesDir, libraries.browserProviders);

  const desired = new Set<string>();
  for (const scenario of libraries.scenarios ?? []) {
    const scenarioId = safeFileName(String(scenario.id ?? `scenario-${Date.now()}`));
    desired.add(`${scenarioId}.yaml`);
    const scenarioPath = ensureInsideRoot(testCasesDir, join(testCasesDir, `${scenarioId}.yaml`));
    writeFileSync(
      scenarioPath,
      `${stringifyYaml({ ...scenario, id: String(scenario.id ?? scenarioId) })}\n`,
      'utf8'
    );
  }

  for (const file of readdirSync(testCasesDir)) {
    if (!(file.endsWith('.yaml') || file.endsWith('.yml'))) continue;
    if (desired.has(file)) continue;
    unlinkSync(ensureInsideRoot(testCasesDir, join(testCasesDir, file)));
  }
}

function ensureTestCasesDir(root: string): { testCasesDir: string; legacyScenariosDir: string } {
  const testCasesDir = join(root, TEST_CASES_DIR_NAME);
  const legacyScenariosDir = join(root, LEGACY_SCENARIOS_DIR_NAME);
  if (!existsSync(testCasesDir) && existsSync(legacyScenariosDir)) {
    try {
      renameSync(legacyScenariosDir, testCasesDir);
    } catch {
      // If rename fails (for example cross-device boundaries), keep fallback read support.
    }
  }
  return { testCasesDir, legacyScenariosDir };
}
