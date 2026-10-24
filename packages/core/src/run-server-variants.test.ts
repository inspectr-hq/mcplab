import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { aggregateResults } from './results.js';
vi.mock('./runner.js', () => ({
  createRunId: () => 'comparison',
  runAll: vi.fn(async (config, options) => {
    const server = config.scenarios[0].servers[0];
    const runDir = join(options.runsDir, server);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'trace.jsonl'),
      JSON.stringify({ type: 'scenario_run', scenario_id: 's', agent: 'a', run_index: 0 })
    );
    return {
      runDir,
      results: aggregateResults({
        runId: server,
        timestamp: '',
        configHash: '',
        cliVersion: '',
        scenarioRuns: [{ scenario_id: 's', agent: 'a', runs: [] }]
      })
    };
  })
}));
import { runServerVariants } from './run-server-variants.js';

it('writes one combined result with separate trace and server identities', async () => {
  const root = mkdtempSync(join(tmpdir(), 'server-comparison-'));
  try {
    const { results, runDir } = await runServerVariants(
      {
        servers: {
          dev: { transport: 'http', url: 'http://dev' },
          prod: { transport: 'http', url: 'http://prod' }
        },
        agents: { a: { provider: 'openai', model: 'test' } },
        scenarios: [{ id: 's', prompt: 'hi', servers: ['dev'] }]
      },
      ['a'],
      [{ id: 'A' }, { id: 'B', serverIds: ['prod'] }],
      { runsPerScenario: 3, configHash: 'hash', cliVersion: 'test', runsDir: root }
    );
    expect(results.scenarios.map((s) => [s.server_variant, s.servers])).toEqual([
      ['A', ['dev']],
      ['B', ['prod']]
    ]);
    expect(results.metadata.rerun_runs_per_scenario).toBe(3);
    expect(readdirSync(root)).toEqual(['comparison']);
    expect(readFileSync(join(runDir, 'trace.jsonl'), 'utf8')).toContain('"server_variant":"B"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
