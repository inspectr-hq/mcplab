import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { SourceScenario } from './types.js';

export type TestCaseCreateInput = { id: string; name?: string; servers: string[]; prompt: string; requiredTools?: string[]; responseRegexPatterns?: string[] };
export type CreatedTestCaseFile = { id: string; path: string; testCase: SourceScenario };

export function createTestCaseFile(params: { librariesDir: string; knownServerIds: Iterable<string>; testCase: TestCaseCreateInput }): CreatedTestCaseFile {
  const input = params.testCase;
  const id = input.id.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Test Case id must use letters, numbers, hyphens, or underscores.');
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('A Test Case needs a prompt.');
  if (prompt.length > 4000) throw new Error('Test Case prompt must be 4000 characters or fewer.');
  const servers = unique(input.servers);
  if (!servers.length) throw new Error('A Test Case needs at least one MCP server.');
  const missing = servers.filter((server) => !new Set(params.knownServerIds).has(server));
  if (missing.length) throw new Error(`Unknown MCP server(s): ${missing.join(', ')}`);
  const librariesDir = resolve(params.librariesDir);
  const testCasesDir = resolve(librariesDir, 'test-cases');
  if (!testCasesDir.startsWith(`${librariesDir}${sep}`)) throw new Error('Test Case path is outside the configured libraries directory.');
  mkdirSync(testCasesDir, { recursive: true });
  const path = resolve(testCasesDir, `${id}.yaml`);
  if (!path.startsWith(`${testCasesDir}${sep}`)) throw new Error('Test Case path is outside the canonical test-cases directory.');
  if (existsSync(path)) throw new Error(`Test Case '${id}' already exists.`);
  const requiredTools = unique(input.requiredTools ?? []);
  const regexes = unique(input.responseRegexPatterns ?? []);
  const testCase: SourceScenario = {
    id, name: input.name?.trim() || id, servers, prompt,
    ...(requiredTools.length || regexes.length ? { eval: {
      ...(requiredTools.length ? { tool_constraints: { required_tools: requiredTools } } : {}),
      ...(regexes.length ? { response_assertions: regexes.map((pattern) => ({ type: 'regex' as const, pattern })) } : {})
    } } : {})
  };
  writeFileSync(path, `${stringifyYaml(testCase)}\n`, 'utf8');
  return { id, path, testCase };
}

function unique(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
