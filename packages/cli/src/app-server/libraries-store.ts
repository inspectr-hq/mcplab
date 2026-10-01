import { basename, extname, join, resolve } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  readFileSync
} from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { BrowserAgentConfig, BrowserProviderProfile, EvalConfig } from '@inspectr/mcplab-core';
import {
  parseBrowserProviderProfiles,
  DEFAULT_BROWSER_PROVIDER_PROFILES,
  readLibraryAgentsAndServers,
  validateBrowserProviderProfile
} from '@inspectr/mcplab-core';
import { ensureInsideRoot, safeFileName } from './store-utils.js';
import { sanitizeBrowserProviderProposalDiagnostics } from './browser-provider-learning.js';

const TEST_CASES_DIR_NAME = 'test-cases';
const LEGACY_SCENARIOS_DIR_NAME = 'scenarios';
const BROWSER_PROVIDERS_DIR_NAME = 'browser-providers';

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
  const browserProviders = {
    ...structuredClone(DEFAULT_BROWSER_PROVIDER_PROFILES),
    ...readBrowserProviderProfiles(root)
  };
  return { servers, agents, scenarios, browserProviders };
}

function readBrowserProviderProfiles(root: string): Record<string, BrowserProviderProfile> {
  const directory = join(root, BROWSER_PROVIDERS_DIR_NAME);
  if (!existsSync(directory)) return {};
  const profiles: Record<string, BrowserProviderProfile> = {};
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    const id = basename(file, extname(file));
    const parsed = readYamlFile<Record<string, unknown> | null>(join(directory, file), null);
    if (!parsed) continue;
    const profile = parseBrowserProviderProfiles({ [id]: parsed })[id];
    const stats = statSync(join(directory, file));
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

export function writeBrowserProviderProfiles(
  librariesDir: string,
  profiles: Record<string, BrowserProviderProfile>
): Record<string, BrowserProviderProfile> {
  const root = resolve(librariesDir);
  mkdirSync(root, { recursive: true });
  const directory = join(root, BROWSER_PROVIDERS_DIR_NAME);
  mkdirSync(directory, { recursive: true });
  const desired = new Set<string>();
  for (const [id, profile] of Object.entries(profiles)) {
    const builtIn = DEFAULT_BROWSER_PROVIDER_PROFILES[id];
    if (
      builtIn &&
      serializeBrowserProviderProfile(builtIn) === serializeBrowserProviderProfile(profile)
    )
      continue;
    const fileStem = safeFileName(id);
    if (fileStem !== id) {
      throw new Error(`Browser provider id '${id}' must be a safe filename.`);
    }
    const fileName = `${fileStem}.yaml`;
    desired.add(fileName);
    const target = join(directory, fileName);
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    const serialized = serializeBrowserProviderProfile(profile);
    const existingRaw = readFileIfPresent(target);
    let shouldWrite = existingRaw === undefined;
    if (existingRaw !== undefined) {
      try {
        const existing = parseBrowserProviderProfiles({
          [id]: parseYaml(existingRaw) as Record<string, unknown>
        })[id];
        shouldWrite = serializeBrowserProviderProfile(existing) !== serialized;
      } catch {
        shouldWrite = true;
      }
    }
    if (shouldWrite) {
      writeFileSync(temporary, serialized, 'utf8');
      renameSync(temporary, target);
    }
  }
  for (const file of readdirSync(directory)) {
    if (!(file.endsWith('.yaml') || file.endsWith('.yml')) || desired.has(file)) continue;
    unlinkSync(join(directory, file));
  }
  return {
    ...structuredClone(DEFAULT_BROWSER_PROVIDER_PROFILES),
    ...readBrowserProviderProfiles(root)
  };
}

function serializeBrowserProviderProfile(profile: BrowserProviderProfile): string {
  return `${stringifyYaml({
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
      working_locator: profile.completion.workingLocator,
      stability_ms: profile.completion.stabilityMs
    },
    new_conversation: profile.newConversation,
    learned: {
      source_origin: profile.learned.sourceOrigin,
      confidence: profile.learned.confidence
    }
  })}\n`;
}

function readFileIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
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
  const browserAgent = {
    id: agent.id,
    type: 'browser' as const,
    name: agent.name,
    provider: profile.id,
    url: agent.url
  };
  const persistedProfiles = writeBrowserProviderProfiles(librariesDir, {
    ...current.browserProviders,
    [profile.id]: profile
  });
  writeLibraries(librariesDir, {
    servers: current.servers,
    agents: { ...current.agents, [agent.id]: browserAgent },
    scenarios: current.scenarios
  });
  return { profile: persistedProfiles[profile.id] ?? profile, agent: browserAgent };
}

export function writeBrowserProviderLearningArtifact(
  librariesDir: string,
  providerId: string,
  artifact: { trace?: unknown; proposalDiagnostics?: unknown; savedAt: string }
): void {
  const root = resolve(librariesDir);
  const directory = join(root, 'browser-provider-learning');
  mkdirSync(directory, { recursive: true });
  const target = join(directory, `${safeFileName(providerId)}.json`);
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  const persistedTrace =
    artifact.trace && typeof artifact.trace === 'object' && !Array.isArray(artifact.trace)
      ? Object.fromEntries(
          Object.entries(artifact.trace as Record<string, unknown>).filter(
            ([key]) => key !== 'selectorValidation'
          )
        )
      : artifact.trace;
  writeFileSync(
    temporary,
    `${JSON.stringify(
      {
        providerId,
        trace: persistedTrace,
        proposalDiagnostics: sanitizeBrowserProviderProposalDiagnostics(
          artifact.proposalDiagnostics
        ),
        savedAt: artifact.savedAt
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  renameSync(temporary, target);
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
  const browserProviders = libraries.browserProviders
    ? Object.fromEntries(
        Object.entries(libraries.browserProviders).map(([id, profile]) => [
          id,
          validateBrowserProviderProfile({ ...profile, id })
        ])
      )
    : undefined;
  const root = resolve(librariesDir);
  const { testCasesDir } = ensureTestCasesDir(root);
  mkdirSync(root, { recursive: true });
  mkdirSync(testCasesDir, { recursive: true });

  writeFileSync(join(root, 'servers.yaml'), `${stringifyYaml(libraries.servers ?? {})}\n`, 'utf8');
  const agents = Object.fromEntries(
    Object.entries(libraries.agents ?? {}).map(([id, agent]) => {
      if (agent.type !== 'browser') return [id, agent];
      const { newConversationBetweenScenarios, ...entry } = agent;
      return [
        id,
        {
          ...entry,
          ...(typeof newConversationBetweenScenarios === 'boolean'
            ? { new_conversation_between_scenarios: newConversationBetweenScenarios }
            : {})
        }
      ];
    })
  );
  writeFileSync(join(root, 'agents.yaml'), `${stringifyYaml(agents)}\n`, 'utf8');
  if (browserProviders) writeBrowserProviderProfiles(librariesDir, browserProviders);

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
