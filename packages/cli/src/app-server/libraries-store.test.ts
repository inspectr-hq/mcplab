import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLibraries, writeLibraries } from './libraries-store.js';

function makeTempLibrariesDir(): string {
  return mkdtempSync(join(tmpdir(), 'mcplab-libs-'));
}

describe('libraries-store test-case directory migration', () => {
  it('writes scenario library files into test-cases directory', () => {
    const librariesDir = makeTempLibrariesDir();
    writeLibraries(librariesDir, {
      servers: [],
      agents: [],
      scenarios: [
        {
          id: 'tc-1',
          name: 'Test Case 1',
          servers: [],
          prompt: 'hello',
          eval: {
            tool_constraints: { required_tools: [], forbidden_tools: [] },
            response_assertions: []
          },
          extract: []
        }
      ]
    });

    expect(existsSync(join(librariesDir, 'test-cases'))).toBe(true);
    expect(existsSync(join(librariesDir, 'test-cases', 'tc-1.yaml'))).toBe(true);
  });

  it('migrates legacy scenarios folder to test-cases when reading libraries', () => {
    const librariesDir = makeTempLibrariesDir();
    const legacyDir = join(librariesDir, 'scenarios');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, 'legacy-case.yaml'),
      `id: legacy-case\nname: Legacy Case\nservers: []\nprompt: legacy\neval:\n  tool_constraints:\n    required_tools: []\n    forbidden_tools: []\n  response_assertions: []\nextract: []\n`,
      'utf8'
    );

    const loaded = readLibraries(librariesDir);

    expect(loaded.scenarios.some((scenario) => scenario.id === 'legacy-case')).toBe(true);
    expect(existsSync(join(librariesDir, 'test-cases'))).toBe(true);
    expect(existsSync(join(librariesDir, 'test-cases', 'legacy-case.yaml'))).toBe(true);
    expect(existsSync(join(librariesDir, 'scenarios'))).toBe(false);
  });

  it('keeps canonical test-cases data when both folders exist', () => {
    const librariesDir = makeTempLibrariesDir();
    const testCasesDir = join(librariesDir, 'test-cases');
    const legacyDir = join(librariesDir, 'scenarios');
    mkdirSync(testCasesDir, { recursive: true });
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(testCasesDir, 'canonical.yaml'),
      `id: canonical\nname: Canonical\nservers: []\nprompt: canonical\neval:\n  tool_constraints:\n    required_tools: []\n    forbidden_tools: []\n  response_assertions: []\nextract: []\n`,
      'utf8'
    );
    writeFileSync(
      join(legacyDir, 'legacy.yaml'),
      `id: legacy\nname: Legacy\nservers: []\nprompt: legacy\neval:\n  tool_constraints:\n    required_tools: []\n    forbidden_tools: []\n  response_assertions: []\nextract: []\n`,
      'utf8'
    );

    const loaded = readLibraries(librariesDir);
    const ids = new Set(loaded.scenarios.map((item) => item.id));

    expect(ids.has('canonical')).toBe(true);
    expect(ids.has('legacy')).toBe(false);
    expect(readdirSync(testCasesDir).includes('canonical.yaml')).toBe(true);
  });
});
