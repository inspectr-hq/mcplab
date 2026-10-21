import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRunsRoutes } from './runs-routes.js';
import { makeRunsRouteDeps } from './runs-routes.test-helpers.js';
import { resolveRunSelectedAgents } from './run-agent-selection.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('workspace default evaluation agent', () => {
  async function request(
    params: { declared?: boolean; defaultName?: string; requested?: string[] } = {}
  ) {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-agent-default-'));
    roots.push(root);
    const configPath = join(root, 'eval.yaml');
    const source = `${params.declared ? 'agents:\n  - id: declared\n    provider: openai\n    model: eval-model\n' : ''}scenarios:\n  - id: s1\n    prompt: test\n    servers: []\n`;
    writeFileSync(configPath, source);
    const libraryAgents = {
      workspace: { provider: 'openai' as const, model: 'workspace-model' },
      other: { provider: 'openai' as const, model: 'other-model' }
    };
    const enqueueRun = vi.fn(() => ({ jobId: 'queued' }));
    const asJson = vi.fn();
    await handleRunsRoutes({
      req: { headers: {} } as any,
      res: {} as any,
      pathname: '/api/runs',
      method: 'POST',
      settings: {
        evalsDir: root,
        librariesDir: root,
        defaultEvaluationAgentName: params.defaultName
      } as any,
      runQueueService: { enqueueRun } as any,
      oauthSessionManager: {} as any,
      deps: makeRunsRouteDeps({
        parseBody: async () => ({ configPath, agents: params.requested }),
        readLibraries: () => ({ agents: libraryAgents, servers: {}, scenarios: {} }),
        resolveRunSelectedAgents,
        asJson
      }) as any
    });
    expect(
      String(await import('node:fs').then(({ readFileSync }) => readFileSync(configPath)))
    ).toBe(source);
    return { enqueueRun, asJson, libraryAgents };
  }

  it('snapshots only the inherited agent at enqueue time without changing the evaluation', async () => {
    const { enqueueRun, asJson, libraryAgents } = await request({ defaultName: 'workspace' });
    expect(asJson).toHaveBeenCalledWith(expect.anything(), 202, expect.anything());
    expect(enqueueRun.mock.calls[0]?.[0]).toMatchObject({
      requestedAgents: ['workspace'],
      agentSelectionSource: 'workspace_default',
      agentSnapshot: { workspace: libraryAgents.workspace }
    });
    libraryAgents.workspace.model = 'changed-later';
    expect((enqueueRun.mock.calls[0]?.[0] as any).agentSnapshot.workspace.model).toBe(
      'workspace-model'
    );
  });
  it('preserves declared agents and supports explicit library overrides', async () => {
    const declared = await request({ declared: true, defaultName: 'workspace' });
    expect(declared.enqueueRun.mock.calls[0]?.[0]).toMatchObject({ requestedAgents: ['declared'] });
    const override = await request({ defaultName: 'workspace', requested: ['other'] });
    expect(override.enqueueRun.mock.calls[0]?.[0]).toMatchObject({ requestedAgents: ['other'] });
  });
  it.each([undefined, 'deleted'])(
    'rejects an empty evaluation with unavailable default %s',
    async (defaultName) => {
      const { enqueueRun, asJson } = await request({ defaultName });
      expect(enqueueRun).not.toHaveBeenCalled();
      expect(asJson).toHaveBeenCalledWith(expect.anything(), 400, {
        error: expect.stringMatching(/agent/i)
      });
    }
  );
});
