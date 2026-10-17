import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateResults } from '@inspectr/mcplab-core';
import { handleInspectrRoutes } from './inspectr-routes.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeRun(inspectrOrigins: string[]): string {
  const runsDir = mkdtempSync(join(tmpdir(), 'mcplab-inspectr-routes-'));
  roots.push(runsDir);
  const results = aggregateResults({
    runId: 'run-1',
    timestamp: '2026-10-17T00:00:00Z',
    configHash: 'test',
    cliVersion: 'test',
    scenarioRuns: [{ scenario_id: 's1', agent: 'a1', runs: [] }]
  });
  results.scenarios[0]!.inspectr_origins = inspectrOrigins;
  mkdirSync(join(runsDir, 'run-1'));
  writeFileSync(join(runsDir, 'run-1', 'results.json'), JSON.stringify(results));
  return runsDir;
}

async function call(runsDir: string, pathname: string, origin: unknown, acquire = vi.fn()) {
  const responses: Array<{ status: number; body: unknown }> = [];
  const handled = await handleInspectrRoutes({
    req: {} as any,
    res: {} as any,
    pathname,
    method: 'POST',
    runsDir,
    inspectrSessionManager: { acquire },
    parseBody: async () => ({ origin }),
    asJson: (_res, status, body) => responses.push({ status, body })
  });
  return { handled, responses, acquire };
}

describe('POST /api/runs/:runId/inspectr', () => {
  it('starts only the requested origin when the run recorded it', async () => {
    const acquire = vi.fn(async (origin: string) => ({
      upstreamOrigin: origin,
      proxyOrigin: 'http://127.0.0.1:1',
      dashboardUrl: 'http://127.0.0.1:2/?channel=c'
    }));
    const { handled, responses } = await call(
      writeRun(['http://upstream.test', 'http://other.test']),
      '/api/runs/run-1/inspectr',
      'http://upstream.test',
      acquire
    );

    expect(handled).toBe(true);
    expect(acquire).toHaveBeenCalledExactlyOnceWith('http://upstream.test');
    expect(responses).toEqual([
      {
        status: 200,
        body: {
          session: {
            upstreamOrigin: 'http://upstream.test',
            dashboardUrl: 'http://127.0.0.1:2/?channel=c'
          }
        }
      }
    ]);
  });

  it('rejects origins the run did not inspect', async () => {
    const { responses, acquire } = await call(
      writeRun(['http://upstream.test']),
      '/api/runs/run-1/inspectr',
      'http://attacker.test'
    );

    expect(acquire).not.toHaveBeenCalled();
    expect(responses[0]?.status).toBe(400);
  });

  it('returns 404 for unknown runs and 502 when Inspectr fails to start', async () => {
    const runsDir = writeRun(['http://upstream.test']);
    const missing = await call(runsDir, '/api/runs/missing/inspectr', 'http://upstream.test');
    expect(missing.responses[0]?.status).toBe(404);

    const failing = await call(
      runsDir,
      '/api/runs/run-1/inspectr',
      'http://upstream.test',
      vi.fn().mockRejectedValue(new Error('Inspectr failed to start'))
    );
    expect(failing.responses).toEqual([
      { status: 502, body: { error: 'Inspectr failed to start' } }
    ]);
  });
});
