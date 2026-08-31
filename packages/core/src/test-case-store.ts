import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { SourceScenario } from './types.js';
import { buildScenarioEntry } from './scenario-builder.js';

export type TestCaseCreateInput = {
  id: string;
  name?: string;
  servers: string[];
  prompt: string;
  requiredTools?: string[];
  forbiddenTools?: string[];
  allowedToolSequences?: string[][];
  responseRegexPatterns?: string[];
  extractRules?: Array<{ name: string; regex: string }>;
};
export type CreatedTestCaseFile = { id: string; path: string; testCase: SourceScenario };

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
    id, name: input.name?.trim() || id, servers, prompt,
    required_tools: input.requiredTools, forbidden_tools: input.forbiddenTools,
    allowed_tool_sequences: input.allowedToolSequences,
    response_regex_patterns: input.responseRegexPatterns, extract_rules: input.extractRules
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

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
