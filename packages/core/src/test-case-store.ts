import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { SourceScenario } from './types.js';
import { buildScenarioEntry } from './scenario-builder.js';

export type TestCaseCreateInput = {
  id: string;
  name?: string;
  servers: string[];
  prompt: string;
  requiredTools?: string[];
  forbiddenTools?: string[];
  toolSequence?: string[];
  responseRegexPatterns?: string[];
  extractRules?: Array<{ name: string; regex: string }>;
};
export type CreatedTestCaseFile = { id: string; path: string; testCase: SourceScenario };
export type UpdatedTestCaseFile = CreatedTestCaseFile;

export function createTestCaseFile(params: {
  librariesDir: string;
  knownServerIds: Iterable<string>;
  testCase: TestCaseCreateInput;
}): CreatedTestCaseFile {
  const input = params.testCase;
  const id = input.id.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error('Test Case id must use letters, numbers, hyphens, or underscores.');
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('A Test Case needs a prompt.');
  if (prompt.length > 4000) throw new Error('Test Case prompt must be 4000 characters or fewer.');
  const servers = unique(input.servers);
  if (!servers.length) throw new Error('A Test Case needs at least one MCP server.');
  const missing = servers.filter((server) => !new Set(params.knownServerIds).has(server));
  if (missing.length) throw new Error(`Unknown MCP server(s): ${missing.join(', ')}`);
  const librariesDir = resolve(params.librariesDir);
  const testCasesDir = resolve(librariesDir, 'test-cases');
  if (!testCasesDir.startsWith(`${librariesDir}${sep}`))
    throw new Error('Test Case path is outside the configured libraries directory.');
  mkdirSync(testCasesDir, { recursive: true });
  const path = resolve(testCasesDir, `${id}.yaml`);
  if (!path.startsWith(`${testCasesDir}${sep}`))
    throw new Error('Test Case path is outside the canonical test-cases directory.');
  if (existsSync(path)) throw new Error(`Test Case '${id}' already exists.`);
  const testCase = buildScenarioEntry({
    id,
    name: input.name?.trim() || id,
    servers,
    prompt,
    required_tools: input.requiredTools,
    forbidden_tools: input.forbiddenTools,
    tool_sequence: input.toolSequence,
    response_regex_patterns: input.responseRegexPatterns,
    extract_rules: input.extractRules
  });
  try {
    writeFileSync(path, `${stringifyYaml(testCase)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Test Case '${id}' already exists.`);
    }
    throw error;
  }
  return { id, path, testCase };
}

export function readTestCaseFile(params: {
  librariesDir: string;
  filePath: string;
}): CreatedTestCaseFile {
  const librariesDir = resolve(params.librariesDir);
  const testCasesDir = resolve(librariesDir, 'test-cases');
  const path = resolve(testCasesDir, params.filePath);
  if (!path.startsWith(`${testCasesDir}${sep}`) || !/\.ya?ml$/i.test(path))
    throw new Error('Test Case path is outside the canonical test-cases directory.');
  if (!existsSync(path)) throw new Error(`Test Case not found: ${params.filePath}`);
  const testCase = parseYaml(readFileSync(path, 'utf8')) as SourceScenario;
  return {
    id: String(testCase.id ?? '').trim(),
    path,
    testCase
  };
}

export function updateTestCaseFile(params: {
  librariesDir: string;
  knownServerIds: Iterable<string>;
  filePath: string;
  testCase: TestCaseCreateInput;
}): UpdatedTestCaseFile {
  const existing = readTestCaseFile({
    librariesDir: params.librariesDir,
    filePath: params.filePath
  });
  const input = params.testCase;
  const id = input.id.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error('Test Case id must use letters, numbers, hyphens, or underscores.');
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('A Test Case needs a prompt.');
  const servers = unique(input.servers);
  if (!servers.length) throw new Error('A Test Case needs at least one MCP server.');
  const known = new Set(params.knownServerIds);
  const missing = servers.filter((server) => !known.has(server));
  if (missing.length) throw new Error(`Unknown MCP server(s): ${missing.join(', ')}`);
  const testCase = buildScenarioEntry({
    id,
    name: input.name?.trim() || id,
    servers,
    prompt,
    required_tools: input.requiredTools,
    forbidden_tools: input.forbiddenTools,
    tool_sequence: input.toolSequence,
    response_regex_patterns: input.responseRegexPatterns,
    extract_rules: input.extractRules
  });
  const librariesDir = resolve(params.librariesDir);
  const testCasesDir = resolve(librariesDir, 'test-cases');
  assertUniqueTestCaseId(testCasesDir, id, existing.path);
  writeFileSync(existing.path, `${stringifyYaml(testCase)}\n`, { encoding: 'utf8' });
  return { id, path: existing.path, testCase };
}

function assertUniqueTestCaseId(
  testCasesDir: string,
  id: string,
  excludingPath?: string
): void {
  if (!existsSync(testCasesDir)) return;
  for (const fileName of readdirSync(testCasesDir)) {
    if (!/\.ya?ml$/i.test(fileName)) continue;
    const candidatePath = resolve(testCasesDir, fileName);
    if (excludingPath && candidatePath === excludingPath) continue;
    let parsed: Record<string, unknown> | null;
    try {
      parsed = parseYaml(readFileSync(candidatePath, 'utf8')) as Record<string, unknown> | null;
    } catch {
      continue;
    }
    if (typeof parsed?.id === 'string' && parsed.id.trim() === id) {
      throw new Error(`Test Case id '${id}' is already used by another Test Case: ${fileName}`);
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
