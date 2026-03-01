import { basename, extname, join, resolve } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  readFileSync
} from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { EvalConfig } from '@inspectr/mcplab-core';
import { ensureInsideRoot, safeFileName } from './store-utils.js';

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

function normalizeServers(raw: unknown): EvalConfig['servers'] {
  const normalized: EvalConfig['servers'] = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const candidate = entry as {
        id?: unknown;
        name?: unknown;
        transport?: EvalConfig['servers'][string]['transport'];
        url?: string;
        auth?: EvalConfig['servers'][string]['auth'];
      };
      const id = String(candidate.id ?? candidate.name ?? '').trim();
      if (!id || !candidate.transport) continue;
      normalized[id] = {
        transport: candidate.transport,
        url: candidate.url,
        auth: candidate.auth
      };
    }
    return normalized;
  }
  if (raw && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const candidate = value as EvalConfig['servers'][string];
      if (!candidate.transport) continue;
      normalized[id] = {
        transport: candidate.transport,
        url: candidate.url,
        auth: candidate.auth
      };
    }
  }
  return normalized;
}

function normalizeAgents(raw: unknown): EvalConfig['agents'] {
  const normalized: EvalConfig['agents'] = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const candidate = entry as {
        id?: unknown;
        name?: unknown;
        provider?: EvalConfig['agents'][string]['provider'];
        model?: string;
        temperature?: number;
        max_tokens?: number;
        system?: string;
      };
      const id = String(candidate.id ?? candidate.name ?? '').trim();
      if (!id || !candidate.provider || !candidate.model) continue;
      normalized[id] = {
        provider: candidate.provider,
        model: candidate.model,
        temperature: candidate.temperature,
        max_tokens: candidate.max_tokens,
        system: candidate.system
      };
    }
    return normalized;
  }
  if (raw && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const candidate = value as EvalConfig['agents'][string];
      if (!candidate.provider || !candidate.model) continue;
      normalized[id] = {
        provider: candidate.provider,
        model: candidate.model,
        temperature: candidate.temperature,
        max_tokens: candidate.max_tokens,
        system: candidate.system
      };
    }
  }
  return normalized;
}

export function readLibraries(librariesDir: string): {
  servers: EvalConfig['servers'];
  agents: EvalConfig['agents'];
  scenarios: EvalConfig['scenarios'];
} {
  const root = resolve(librariesDir);
  const scenariosDir = join(root, 'scenarios');
  const servers = normalizeServers(readYamlFile<unknown>(join(root, 'servers.yaml'), {}));
  const agents = normalizeAgents(readYamlFile<unknown>(join(root, 'agents.yaml'), {}));
  const scenarios: EvalConfig['scenarios'] = [];
  if (existsSync(scenariosDir)) {
    const files = readdirSync(scenariosDir)
      .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
      .sort((a, b) => a.localeCompare(b));
    for (const file of files) {
      const scenarioPath = ensureInsideRoot(scenariosDir, join(scenariosDir, file));
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
  const scenariosDir = join(root, 'scenarios');
  mkdirSync(root, { recursive: true });
  mkdirSync(scenariosDir, { recursive: true });

  writeFileSync(join(root, 'servers.yaml'), `${stringifyYaml(libraries.servers ?? {})}\n`, 'utf8');
  writeFileSync(join(root, 'agents.yaml'), `${stringifyYaml(libraries.agents ?? {})}\n`, 'utf8');

  const desired = new Set<string>();
  for (const scenario of libraries.scenarios ?? []) {
    const scenarioId = safeFileName(String(scenario.id ?? `scenario-${Date.now()}`));
    desired.add(`${scenarioId}.yaml`);
    const scenarioPath = ensureInsideRoot(scenariosDir, join(scenariosDir, `${scenarioId}.yaml`));
    writeFileSync(
      scenarioPath,
      `${stringifyYaml({ ...scenario, id: String(scenario.id ?? scenarioId) })}\n`,
      'utf8'
    );
  }

  for (const file of readdirSync(scenariosDir)) {
    if (!(file.endsWith('.yaml') || file.endsWith('.yml'))) continue;
    if (desired.has(file)) continue;
    unlinkSync(ensureInsideRoot(scenariosDir, join(scenariosDir, file)));
  }
}
