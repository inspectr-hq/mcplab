import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleEvalsRoutes } from './evals-routes.js';
import { listConfigs, readConfigRecord, readConfigRecordOrInvalid } from './config-store.js';
import { decodeEvalId, ensureInsideRoot, encodeEvalId, safeFileName } from './store-utils.js';

describe('handleEvalsRoutes', () => {
  it('preserves invalid tool-rule scenarios when opening, repairing, and saving a config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-evals-routes-'));
    const evalsDir = join(root, 'mcplab', 'evals');
    mkdirSync(evalsDir, { recursive: true });
    const configPath = join(evalsDir, 'invalid-rules.yaml');
    writeFileSync(
      configPath,
      [
        'name: Existing config',
        'agents: []',
        'scenarios:',
        '  - id: broken-rule',
        '    name: Broken rule scenario',
        '    prompt: Keep this prompt',
        '    eval:',
        '      tool_constraints:',
        '        required_tools: [search]',
        '        forbidden_tools: [search]',
        '  - id: untouched',
        '    name: Untouched scenario',
        '    prompt: Keep this too'
      ].join('\n') + '\n',
      'utf8'
    );

    const opened = readConfigRecordOrInvalid(configPath, evalsDir, join(root, 'mcplab'));
    expect(opened.error).toContain('entirely forbidden');
    expect(opened.config.scenarios.map((scenario) => scenario.id)).toEqual([
      'broken-rule',
      'untouched'
    ]);

    const repairedConfig = {
      ...opened.config,
      scenarios: opened.config.scenarios.map((scenario) =>
        scenario.id === 'broken-rule'
          ? { ...scenario, eval: { tool_constraints: { required_tools: ['search'] } } }
          : scenario
      )
    };
    const captured: Array<{ status: number; body: unknown }> = [];
    await handleEvalsRoutes({
      req: {} as any,
      res: {} as any,
      pathname: `/api/evals/${encodeEvalId(configPath, evalsDir)}`,
      method: 'PUT',
      settings: { evalsDir, librariesDir: join(root, 'mcplab') } as any,
      deps: {
        parseBody: async () => ({ config: repairedConfig }),
        asJson: (_res, status, responseBody) => captured.push({ status, body: responseBody }),
        listConfigs,
        safeFileName,
        ensureInsideRoot,
        decodeEvalId,
        readConfigRecord,
        readConfigRecordOrInvalid
      }
    });

    expect(captured[0]?.status).toBe(200);
    const saved = readFileSync(configPath, 'utf8');
    expect(saved).toContain('id: broken-rule');
    expect(saved).toContain('id: untouched');
    expect(saved).toContain('Keep this prompt');
    expect(
      (captured[0]?.body as { config?: { scenarios?: unknown[] } } | undefined)?.config?.scenarios
    ).toHaveLength(2);
  });

  it('keeps renamed config inside the original nested directory on PUT', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-evals-routes-'));
    const evalsDir = join(root, 'mcplab', 'evals');
    const nestedDir = join(evalsDir, 'suite-a');
    mkdirSync(nestedDir, { recursive: true });

    const originalPath = join(nestedDir, 'original.yaml');
    writeFileSync(originalPath, 'name: Original\nagents: []\nscenarios: []\n', 'utf8');

    const captured: Array<{ status: number; body: unknown }> = [];
    const body = {
      fileName: 'renamed',
      config: {
        name: 'Renamed',
        agents: [],
        scenarios: []
      }
    };

    const handled = await handleEvalsRoutes({
      req: {} as any,
      res: {} as any,
      pathname: `/api/evals/${encodeEvalId(originalPath, evalsDir)}`,
      method: 'PUT',
      settings: { evalsDir, librariesDir: join(root, 'mcplab') } as any,
      deps: {
        parseBody: async () => body,
        asJson: (_res, status, responseBody) => captured.push({ status, body: responseBody }),
        listConfigs,
        safeFileName,
        ensureInsideRoot,
        decodeEvalId,
        readConfigRecord,
        readConfigRecordOrInvalid
      }
    });

    const nestedRenamedPath = join(nestedDir, 'renamed.yaml');
    const rootRenamedPath = join(evalsDir, 'renamed.yaml');

    expect(handled).toBe(true);
    expect(captured[0]?.status).toBe(200);
    expect(existsSync(originalPath)).toBe(false);
    expect(existsSync(nestedRenamedPath)).toBe(true);
    expect(existsSync(rootRenamedPath)).toBe(false);
    expect((captured[0]?.body as { relativePath?: string } | undefined)?.relativePath).toBe(
      'suite-a/renamed.yaml'
    );
  });

  it('keeps collision suffix rename inside the original nested directory on PUT', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-evals-routes-'));
    const evalsDir = join(root, 'mcplab', 'evals');
    const nestedDir = join(evalsDir, 'suite-a');
    mkdirSync(nestedDir, { recursive: true });

    const originalPath = join(nestedDir, 'original.yaml');
    const collidingPath = join(nestedDir, 'renamed.yaml');
    writeFileSync(originalPath, 'name: Original\nagents: []\nscenarios: []\n', 'utf8');
    writeFileSync(collidingPath, 'name: Existing\nagents: []\nscenarios: []\n', 'utf8');

    const captured: Array<{ status: number; body: unknown }> = [];
    const body = {
      fileName: 'renamed',
      config: {
        name: 'Renamed',
        agents: [],
        scenarios: []
      }
    };

    const handled = await handleEvalsRoutes({
      req: {} as any,
      res: {} as any,
      pathname: `/api/evals/${encodeEvalId(originalPath, evalsDir)}`,
      method: 'PUT',
      settings: { evalsDir, librariesDir: join(root, 'mcplab') } as any,
      deps: {
        parseBody: async () => body,
        asJson: (_res, status, responseBody) => captured.push({ status, body: responseBody }),
        listConfigs,
        safeFileName,
        ensureInsideRoot,
        decodeEvalId,
        readConfigRecord,
        readConfigRecordOrInvalid
      }
    });

    const nestedSuffixedPath = join(nestedDir, 'renamed-1.yaml');
    const rootSuffixedPath = join(evalsDir, 'renamed-1.yaml');

    expect(handled).toBe(true);
    expect(captured[0]?.status).toBe(200);
    expect(existsSync(originalPath)).toBe(false);
    expect(existsSync(collidingPath)).toBe(true);
    expect(existsSync(nestedSuffixedPath)).toBe(true);
    expect(existsSync(rootSuffixedPath)).toBe(false);
    expect((captured[0]?.body as { relativePath?: string } | undefined)?.relativePath).toBe(
      'suite-a/renamed-1.yaml'
    );
  });

  it('renames root-level config within evals root on PUT', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-evals-routes-'));
    const evalsDir = join(root, 'mcplab', 'evals');
    mkdirSync(evalsDir, { recursive: true });

    const originalPath = join(evalsDir, 'original.yaml');
    writeFileSync(originalPath, 'name: Original\nagents: []\nscenarios: []\n', 'utf8');

    const captured: Array<{ status: number; body: unknown }> = [];
    const body = {
      fileName: 'renamed',
      config: {
        name: 'Renamed',
        agents: [],
        scenarios: []
      }
    };

    const handled = await handleEvalsRoutes({
      req: {} as any,
      res: {} as any,
      pathname: `/api/evals/${encodeEvalId(originalPath, evalsDir)}`,
      method: 'PUT',
      settings: { evalsDir, librariesDir: join(root, 'mcplab') } as any,
      deps: {
        parseBody: async () => body,
        asJson: (_res, status, responseBody) => captured.push({ status, body: responseBody }),
        listConfigs,
        safeFileName,
        ensureInsideRoot,
        decodeEvalId,
        readConfigRecord,
        readConfigRecordOrInvalid
      }
    });

    const renamedPath = join(evalsDir, 'renamed.yaml');

    expect(handled).toBe(true);
    expect(captured[0]?.status).toBe(200);
    expect(existsSync(originalPath)).toBe(false);
    expect(existsSync(renamedPath)).toBe(true);
    expect((captured[0]?.body as { relativePath?: string } | undefined)?.relativePath).toBe(
      'renamed.yaml'
    );
  });

  it('persists the optional description through the HTTP update route', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-evals-routes-'));
    const evalsDir = join(root, 'mcplab', 'evals');
    mkdirSync(evalsDir, { recursive: true });
    const configPath = join(evalsDir, 'described.yaml');
    writeFileSync(configPath, 'name: Before\nagents: []\nscenarios: []\n', 'utf8');

    const captured: Array<{ status: number; body: unknown }> = [];
    await handleEvalsRoutes({
      req: {} as any,
      res: {} as any,
      pathname: `/api/evals/${encodeEvalId(configPath, evalsDir)}`,
      method: 'PUT',
      settings: { evalsDir, librariesDir: join(root, 'mcplab') } as any,
      deps: {
        parseBody: async () => ({
          config: { name: 'After', description: 'Saved from API', agents: [], scenarios: [] }
        }),
        asJson: (_res, status, responseBody) => captured.push({ status, body: responseBody }),
        listConfigs,
        safeFileName,
        ensureInsideRoot,
        decodeEvalId,
        readConfigRecord,
        readConfigRecordOrInvalid
      }
    });

    expect(captured[0]?.status).toBe(200);
    expect(readFileSync(configPath, 'utf8')).toContain('description: Saved from API');
    expect(
      (captured[0]?.body as { config?: { description?: string } } | undefined)?.config?.description
    ).toBe('Saved from API');
  });
});
