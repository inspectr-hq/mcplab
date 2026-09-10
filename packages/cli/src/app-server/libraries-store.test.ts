import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLibraries, writeBrowserProviderAndAgent, writeBrowserProviderProfiles, writeLibraries } from './libraries-store.js';

function makeTempLibrariesDir(): string {
  return mkdtempSync(join(tmpdir(), 'mcplab-libs-'));
}

describe('libraries-store test-case directory migration', () => {
  it('loads and atomically writes declarative browser provider profiles', () => {
    const librariesDir = makeTempLibrariesDir();
    writeFileSync(join(librariesDir, 'browser-providers.yaml'), `trendminer:\n  schema_version: 1\n  name: TrendMiner\n  match:\n    origins:\n      - https://tm-pipeline-aa01.trendminer.net\n  composer:\n    locator:\n      segments:\n        - '[data-test="composer"]'\n    input_mode: contenteditable\n  submit:\n    action: enter\n  assistant_messages:\n    locator:\n      segments:\n        - '.assistant'\n  completion:\n    stability_ms: 1000\n  learned:\n    source_origin: https://tm-pipeline-aa01.trendminer.net\n    confidence:\n      composer: high\n`, 'utf8');

    expect(readLibraries(librariesDir).browserProviders.trendminer.name).toBe('TrendMiner');
    writeBrowserProviderProfiles(librariesDir, readLibraries(librariesDir).browserProviders);
    expect(readLibraries(librariesDir).browserProviders.trendminer.composer.inputMode).toBe('contenteditable');
  });

  it('links a learned provider to a browser agent', () => {
    const librariesDir = makeTempLibrariesDir();
    const profile = readLibraries(librariesDir).browserProviders;
    const next = {
      id: 'claude-learned',
      name: 'Claude learned',
      provider: 'claude-learned',
      url: 'https://claude.ai'
    };
    const created = writeBrowserProviderAndAgent(librariesDir, {
      id: 'claude-learned',
      name: 'Claude learned',
      match: { origins: ['https://claude.ai'] },
      composer: { locator: { segments: ['[contenteditable="true"]'] }, inputMode: 'contenteditable' },
      submit: { action: 'enter' },
      assistantMessages: { locator: { segments: ['.assistant'] } },
      completion: { stabilityMs: 1000 },
      learned: { sourceOrigin: 'https://claude.ai', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z', confidence: {} },
      schemaVersion: 1
    }, next);
    expect(created.agent.provider).toBe('claude-learned');
    expect(readLibraries(librariesDir).agents['claude-learned']).toMatchObject({ type: 'browser', provider: 'claude-learned' });
    expect(readLibraries(librariesDir).browserProviders['claude-learned']).toBeDefined();
    const updated = writeBrowserProviderAndAgent(librariesDir, {
      id: 'claude-learned',
      name: 'Claude learned v2',
      match: { origins: ['https://claude.ai'] },
      composer: { locator: { segments: ['[contenteditable="true"]'] }, inputMode: 'contenteditable' },
      submit: { action: 'enter' },
      assistantMessages: { locator: { segments: ['[data-testid="assistant"]'] } },
      completion: { stabilityMs: 1500 },
      learned: { sourceOrigin: 'https://claude.ai', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:01:00.000Z', confidence: {} },
      schemaVersion: 1
    }, { ...next, name: 'Claude learned browser v2' });
    expect(updated.agent.name).toBe('Claude learned browser v2');
    expect(readLibraries(librariesDir).browserProviders['claude-learned'].name).toBe('Claude learned v2');
    expect(profile).toEqual({});
  });

  it('loads servers and agents from library yaml files', () => {
    const librariesDir = makeTempLibrariesDir();
    writeFileSync(
      join(librariesDir, 'servers.yaml'),
      'weather:\n  transport: http\n  url: http://localhost:3300/mcp\n',
      'utf8'
    );
    writeFileSync(
      join(librariesDir, 'agents.yaml'),
      'mini:\n  provider: openai\n  model: gpt-5-mini\n',
      'utf8'
    );

    const loaded = readLibraries(librariesDir);
    expect(loaded.servers.weather?.url).toBe('http://localhost:3300/mcp');
    expect(loaded.agents.mini?.model).toBe('gpt-5-mini');
  });

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
