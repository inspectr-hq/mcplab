import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readLibraries,
  writeBrowserProviderAndAgent,
  writeBrowserProviderLearningArtifact,
  writeBrowserProviderProfiles,
  writeLibraries
} from './libraries-store.js';

function makeTempLibrariesDir(): string {
  return mkdtempSync(join(tmpdir(), 'mcplab-libs-'));
}

describe('libraries-store test-case directory migration', () => {
  it('round-trips learned working and New Chat confirmation through YAML', () => {
    const librariesDir = makeTempLibrariesDir();
    writeBrowserProviderProfiles(librariesDir, {
      'custom-chat': {
        schemaVersion: 1,
        id: 'custom-chat',
        name: 'Custom Chat',
        match: { origins: ['https://example.com'] },
        composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' },
        submit: { action: 'click', locator: { segments: ['button.send'] } },
        assistantMessages: { locator: { segments: ['.assistant'] } },
        completion: {
          stabilityMs: 2500,
          workingLocator: { segments: ['[aria-busy="true"]'] }
        },
        newConversation: {
          action: 'click',
          locator: { segments: ['button.new-chat'] },
          locators: [{ segments: ['button.new-chat'] }],
          confirmation: 'context-change'
        },
        learned: {
          sourceOrigin: 'https://example.com',
          createdAt: '2026-09-20T00:00:00.000Z',
          updatedAt: '2026-09-20T00:00:00.000Z',
          confidence: {}
        }
      }
    });
    expect(readLibraries(librariesDir).browserProviders['custom-chat']).toMatchObject({
      completion: { workingLocator: { segments: ['[aria-busy="true"]'] } },
      newConversation: {
        locators: [{ segments: ['button.new-chat'] }],
        confirmation: 'context-change'
      }
    });
  });

  it('persists redacted provider learning diagnostics separately from the profile', () => {
    const librariesDir = makeTempLibrariesDir();
    writeBrowserProviderLearningArtifact(librariesDir, 'learned/provider', {
      trace: {
        observedGeneration: true,
        selectorValidation: { rawPageContent: 'do not persist' }
      },
      proposalDiagnostics: {
        rationale: ['stable', 'x'.repeat(600), { raw: 'drop me' }],
        warnings: []
      },
      savedAt: '2026-09-17T00:00:00.000Z'
    });
    const artifact = JSON.parse(
      readFileSync(join(librariesDir, 'browser-provider-learning', 'learned-provider.json'), 'utf8')
    );
    expect(artifact).toMatchObject({
      providerId: 'learned/provider',
      trace: { observedGeneration: true },
      proposalDiagnostics: { rationale: ['stable', 'x'.repeat(500)], warnings: [] }
    });
    expect(artifact.trace).not.toHaveProperty('selectorValidation');
    expect(JSON.stringify(artifact)).not.toContain('drop me');
    expect(JSON.stringify(artifact)).not.toContain('do not persist');
  });

  it('loads provider profiles from individual files and derives timestamps from file metadata', () => {
    const librariesDir = makeTempLibrariesDir();
    mkdirSync(join(librariesDir, 'browser-providers'));
    writeFileSync(
      join(librariesDir, 'browser-providers', 'trendminer.yaml'),
      `schema_version: 1\nname: TrendMiner\nmatch:\n  origins:\n    - https://tm-pipeline-aa01.trendminer.net\ncomposer:\n  locator:\n    segments:\n      - '[data-test="composer"]'\n  input_mode: contenteditable\nsubmit:\n  action: enter\nassistant_messages:\n  locator:\n    segments:\n      - '.assistant'\ncompletion:\n  stability_ms: 1000\nlearned:\n  source_origin: https://tm-pipeline-aa01.trendminer.net\n  confidence:\n    composer: high\n`,
      'utf8'
    );

    const loaded = readLibraries(librariesDir).browserProviders.trendminer;
    expect(loaded.name).toBe('TrendMiner');
    expect(loaded.learned.createdAt).toEqual(expect.any(String));
    expect(loaded.learned.updatedAt).toEqual(expect.any(String));
    expect(Date.parse(loaded.learned.createdAt)).not.toBeNaN();
    expect(Date.parse(loaded.learned.updatedAt)).not.toBeNaN();

    const firstCreatedAt = loaded.learned.createdAt;
    writeBrowserProviderProfiles(librariesDir, readLibraries(librariesDir).browserProviders);
    expect(readLibraries(librariesDir).browserProviders.trendminer.composer.inputMode).toBe(
      'contenteditable'
    );
    expect(readLibraries(librariesDir).browserProviders.trendminer.learned.createdAt).toBe(
      firstCreatedAt
    );
    expect(existsSync(join(librariesDir, 'browser-providers.yaml'))).toBe(false);
    expect(
      readFileSync(join(librariesDir, 'browser-providers', 'trendminer.yaml'), 'utf8')
    ).not.toMatch(/created_at|updated_at/);
  });

  it('links a learned provider to a browser agent', () => {
    const librariesDir = makeTempLibrariesDir();
    writeFileSync(
      join(librariesDir, 'agents.yaml'),
      'existing-browser:\n  type: browser\n  provider: existing\n  url: https://example.com\n  new_conversation_between_scenarios: false\n',
      'utf8'
    );
    expect(readLibraries(librariesDir).agents['existing-browser']).toMatchObject({
      newConversationBetweenScenarios: false
    });
    const profile = readLibraries(librariesDir).browserProviders;
    const next = {
      id: 'claude-learned',
      name: 'Claude learned',
      provider: 'claude-learned',
      url: 'https://claude.ai'
    };
    const created = writeBrowserProviderAndAgent(
      librariesDir,
      {
        id: 'claude-learned',
        name: 'Claude learned',
        match: { origins: ['https://claude.ai'] },
        composer: {
          locator: { segments: ['[contenteditable="true"]'] },
          inputMode: 'contenteditable'
        },
        submit: { action: 'enter' },
        assistantMessages: { locator: { segments: ['.assistant'] } },
        completion: { stabilityMs: 1000 },
        learned: {
          sourceOrigin: 'https://claude.ai',
          createdAt: '2026-09-10T00:00:00.000Z',
          updatedAt: '2026-09-10T00:00:00.000Z',
          confidence: {}
        },
        schemaVersion: 1
      },
      next
    );
    expect(created.agent.provider).toBe('claude-learned');
    expect(readLibraries(librariesDir).agents['claude-learned']).toMatchObject({
      type: 'browser',
      provider: 'claude-learned'
    });
    expect(readLibraries(librariesDir).browserProviders['claude-learned']).toBeDefined();
    expect(readLibraries(librariesDir).agents['existing-browser']).toMatchObject({
      newConversationBetweenScenarios: false
    });
    const updated = writeBrowserProviderAndAgent(
      librariesDir,
      {
        id: 'claude-learned',
        name: 'Claude learned v2',
        match: { origins: ['https://claude.ai'] },
        composer: {
          locator: { segments: ['[contenteditable="true"]'] },
          inputMode: 'contenteditable'
        },
        submit: { action: 'enter' },
        assistantMessages: { locator: { segments: ['[data-testid="assistant"]'] } },
        completion: { stabilityMs: 1500 },
        learned: {
          sourceOrigin: 'https://claude.ai',
          createdAt: '2026-09-10T00:00:00.000Z',
          updatedAt: '2026-09-10T00:01:00.000Z',
          confidence: {}
        },
        schemaVersion: 1
      },
      { ...next, name: 'Claude learned browser v2' }
    );
    expect(updated.agent.name).toBe('Claude learned browser v2');
    expect(readLibraries(librariesDir).browserProviders['claude-learned'].name).toBe(
      'Claude learned v2'
    );
    expect(
      readLibraries(librariesDir).browserProviders['claude-learned'].learned.createdAt
    ).toEqual(expect.any(String));
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

  it('persists browser provider profiles when writing the complete library bundle', () => {
    const librariesDir = makeTempLibrariesDir();
    const profile = {
      schemaVersion: 1,
      name: 'Custom Provider',
      match: { origins: ['https://custom.example'] },
      composer: { locator: { segments: ['textarea'] }, inputMode: 'textarea' },
      submit: { action: 'enter' },
      assistantMessages: { locator: { segments: ['.message'] } },
      completion: { stabilityMs: 500 },
      learned: { sourceOrigin: 'https://custom.example', confidence: {} }
    };

    writeLibraries(librariesDir, {
      servers: {},
      agents: {},
      scenarios: [],
      browserProviders: { 'custom-provider': profile }
    });

    expect(readLibraries(librariesDir).browserProviders['custom-provider']).toMatchObject({
      id: 'custom-provider',
      name: 'Custom Provider'
    });
  });

  it('rejects malformed or executable browser provider profiles before writing libraries', () => {
    const librariesDir = makeTempLibrariesDir();
    writeFileSync(join(librariesDir, 'servers.yaml'), 'existing: true\n', 'utf8');

    expect(() =>
      writeLibraries(librariesDir, {
        servers: { next: { transport: 'http', url: 'http://next.example' } },
        agents: {},
        scenarios: [],
        browserProviders: {
          invalid: { schemaVersion: 1, name: 'Invalid' }
        }
      })
    ).toThrow();

    expect(readFileSync(join(librariesDir, 'servers.yaml'), 'utf8')).toBe('existing: true\n');
    expect(() =>
      writeLibraries(librariesDir, {
        servers: {},
        agents: {},
        scenarios: [],
        browserProviders: { invalid: { script: 'alert(1)' } }
      })
    ).toThrow('Executable browser provider profiles are not supported.');
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
