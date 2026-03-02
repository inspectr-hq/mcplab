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
import type { EvalConfig } from '@inspectr/mcplab-core';
import { normalizeLibraryAgents, normalizeLibraryServers } from '@inspectr/mcplab-core';
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
} {
  const root = resolve(librariesDir);
  const { testCasesDir, legacyScenariosDir } = ensureTestCasesDir(root);
  const servers = normalizeLibraryServers(readYamlFile<unknown>(join(root, 'servers.yaml'), {}));
  const agents = normalizeLibraryAgents(readYamlFile<unknown>(join(root, 'agents.yaml'), {}));
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
  return { servers, agents, scenarios };
}

export function writeLibraries(
  librariesDir: string,
  libraries: {
    servers: EvalConfig['servers'];
    agents: EvalConfig['agents'];
    scenarios: EvalConfig['scenarios'];
  }
) {
  const root = resolve(librariesDir);
  const { testCasesDir } = ensureTestCasesDir(root);
  mkdirSync(root, { recursive: true });
  mkdirSync(testCasesDir, { recursive: true });

  writeFileSync(join(root, 'servers.yaml'), `${stringifyYaml(libraries.servers ?? {})}\n`, 'utf8');
  writeFileSync(join(root, 'agents.yaml'), `${stringifyYaml(libraries.agents ?? {})}\n`, 'utf8');

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
