import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { SourceScenario } from './types.js';

export type TestCaseCreateInput = {
  id: string;
  name?: string;
  servers: string[];
  prompt: string;
  requiredTools?: string[];
  responseRegexPatterns?: string[];
};

export type CreatedTestCaseFile = {
  id: string;
  path: string;
  testCase: SourceScenario;
};

/**
 * Creates one canonical Test Case. Both the app API and MCP tool call this
 * function so they share input validation and file persistence semantics.
 */
export function createTestCaseFile(params: {
  librariesDir: string;
  knownServerIds: Iterable<string>;
  testCase: TestCaseCreateInput;
}): CreatedTestCaseFile {
  const id = params.testCase.id.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Test Case id must use letters, numbers, hyphens, or underscores.');
  }
  const prompt = params.testCase.prompt.trim();
  if (!prompt) throw new Error('A Test Case needs a prompt.');
  if (prompt.length > 4000) throw new Error('Test Case prompt must be 4000 characters or fewer.');
  const servers = uniqueNonEmptyStrings(params.testCase.servers);
  if (servers.length === 0) throw new Error('A Test Case needs at least one MCP server.');
  const knownServerIds = new Set(params.knownServerIds);
  const missingServers = servers.filter((server) => !knownServerIds.has(server));
  if (missingServers.length) throw new Error(`Unknown MCP server(s): ${missingServers.join(', ')}`);

  const librariesDir = resolve(params.librariesDir);
  const testCasesDir = resolve(librariesDir, 'test-cases');
  if (!testCasesDir.startsWith(`${librariesDir}${sep}`)) {
    throw new Error('Test Case path is outside the configured libraries directory.');
  }
  mkdirSync(testCasesDir, { recursive: true });
  const path = resolve(testCasesDir, `${id}.yaml`);
  if (!path.startsWith(`${testCasesDir}${sep}`)) {
    throw new Error('Test Case path is outside the canonical test-cases directory.');
  }
  if (existsSync(path)) throw new Error(`Test Case '${id}' already exists.`);

  const requiredTools = uniqueNonEmptyStrings(params.testCase.requiredTools ?? []);
  const responseRegexPatterns = uniqueNonEmptyStrings(params.testCase.responseRegexPatterns ?? []);
  const testCase: SourceScenario = {
    id,
    name: params.testCase.name?.trim() || id,
    servers,
    prompt,
    ...(requiredTools.length || responseRegexPatterns.length
      ? {
          eval: {
            ...(requiredTools.length ? { tool_constraints: { required_tools: requiredTools } } : {}),
            ...(responseRegexPatterns.length
              ? { response_assertions: responseRegexPatterns.map((pattern) => ({ type: 'regex' as const, pattern })) }
              : {})
          }
        }
      : {})
  };
  writeFileSync(path, `${stringifyYaml(testCase)}\n`, 'utf8');
  return { id, path, testCase };
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
