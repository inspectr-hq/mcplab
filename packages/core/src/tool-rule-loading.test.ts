import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture(expression: string, forbidden = 'delete') {
  const root = mkdtempSync(join(tmpdir(), 'mcplab-tool-rules-'));
  roots.push(root);
  const path = join(root, 'eval.yaml');
  const source = `agents: []\nscenarios:\n  - id: s1\n    prompt: Test\n    eval:\n      tool_constraints:\n        required_tools: [${expression}]\n        forbidden_tools: [${forbidden}]\n      tool_sequence: [${expression}, fetch]\n`;
  writeFileSync(path, source);
  return { root, path, source };
}
describe('tool expression config boundaries', () => {
  it('validates without changing authored spacing or file bytes', () => {
    const { path, source } = fixture('search | lookup');
    const loaded = loadConfig(path);
    expect(loaded.sourceConfig.scenarios[0]).toMatchObject({
      eval: { tool_constraints: { required_tools: ['search | lookup'] } }
    });
    expect(readFileSync(path, 'utf8')).toBe(source);
  });
  it.each(['search|', '|lookup', 'search|search'])('rejects malformed %s at load', (expression) => {
    const { path } = fixture(expression);
    expect(() => loadConfig(path)).toThrow();
  });
  it('validates referenced test cases at load without altering library files', () => {
    const { root, path } = fixture('search');
    mkdirSync(join(root, 'test-cases'));
    const libraryPath = join(root, 'test-cases', 'shared.yaml');
    const source = 'id: shared\nprompt: Test\neval:\n  tool_sequence: [search|]\n';
    writeFileSync(libraryPath, source);
    writeFileSync(path, 'agents: []\nscenarios:\n  - ref: shared\n');
    expect(() => loadConfig(path, { bundleRoot: root })).toThrow('shared');
    expect(readFileSync(libraryPath, 'utf8')).toBe(source);
  });
});
