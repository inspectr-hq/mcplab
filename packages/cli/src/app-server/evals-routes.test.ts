import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleEvalsRoutes } from './evals-routes.js';
import { listConfigs, readConfigRecord, readConfigRecordOrInvalid } from './config-store.js';
import { decodeEvalId, ensureInsideRoot, encodeEvalId, safeFileName } from './store-utils.js';

describe('handleEvalsRoutes', () => {
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
});
