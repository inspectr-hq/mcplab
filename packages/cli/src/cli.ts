#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import kleur from 'kleur';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  loadConfig,
  selectScenarios,
  runAll,
  expandConfigForAgents,
  type EvalConfig,
  type SourceEvalConfig,
  type ExecutableEvalConfig,
  type ResultsJson
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import { execSync } from 'node:child_process';
import chokidar from 'chokidar';
import { stringify as stringifyYaml } from 'yaml';
import { startAppServer } from './app-server/index.js';
import {
  applySnapshotPolicyToRunResult,
  buildSnapshotFromRun,
  compareRunToSnapshot,
  formatSnapshotComparisonTable,
  listSnapshots,
  loadSnapshot,
  saveSnapshot
} from './snapshot.js';

const pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  ?.version as string;

const program = new Command();
program
  .name('mcplab')
  .description('Laboratory for testing Model Context Protocol servers')
  .version(pkgVersion);

program
  .command('run')
  .description('Run evaluation scenarios')
  .requiredOption('-c, --config <path>', 'Path to eval.yaml')
  .option('-s, --scenario <id>', 'Run a single scenario')
  .option('-n, --runs <count>', 'Variance runs', '1')
  .option(
    '--agents <agents>',
    'Comma-separated list of agents to test (runs each scenario with each agent)'
  )
  .option('--snapshot-eval', 'Apply snapshot eval policy configured in the config')
  .option('--compare-snapshot <snapshotId>', 'Compare completed run against snapshot id')
  .option('--runs-dir <path>', 'Directory for run artifacts', 'mcplab/results/evaluation-runs')
  .option('--snapshots-dir <path>', 'Directory for snapshots', 'mcplab/snapshots')
  .action(async (options) => {
    try {
      let { config, hash, warnings } = loadConfig(resolve(options.config));
      for (const warning of warnings) {
        console.log(kleur.yellow(`⚠ ${warning}`));
      }

      const requestedAgents = options.agents
        ? options.agents
            .split(',')
            .map((a: string) => a.trim())
            .filter(Boolean)
        : undefined;
      const beforeExpandCount = config.scenarios.length;
      const effectiveAgents = requestedAgents ?? config.run_defaults?.selected_agents;
      const expanded = expandConfigForAgents(config, effectiveAgents);
      if (expanded.scenarios.length !== beforeExpandCount || effectiveAgents?.length) {
        const agentCount = effectiveAgents?.length ?? Object.keys(config.agents).length;
        console.log(
          kleur.cyan(
            `📊 Testing ${beforeExpandCount} scenarios × ${agentCount} selected agents = ${expanded.scenarios.length} total tests`
          )
        );
      }

      const selected = selectScenarios(expanded, options.scenario);
      const runsPerScenario = Number(options.runs);
      if (Number.isNaN(runsPerScenario) || runsPerScenario <= 0) {
        throw new Error('Runs must be a positive number');
      }
      const { runDir, results } = await runAll(selected, {
        runsPerScenario,
        scenarioId: options.scenario,
        configHash: hash,
        gitCommit: getGitCommit(),
        cliVersion: pkgVersion,
        runsDir: String(options.runsDir)
      });
      let shouldFailOnDrift = false;
      const useSnapshotEval =
        Boolean(options.snapshotEval) || Boolean(config.snapshot_eval?.enabled);

      if (useSnapshotEval) {
        const policy = config.snapshot_eval;
        if (!policy?.baseline_snapshot_id) {
          console.log(
            kleur.yellow('⚠ Snapshot eval enabled but no baseline snapshot is configured.')
          );
        } else {
          const snapshot = loadSnapshot(
            String(policy.baseline_snapshot_id),
            resolve(options.snapshotsDir)
          );
          const comparison = compareRunToSnapshot(results, snapshot);
          const enabledScenarioIds = new Set(
            selected.scenarios
              .filter((scenario) => scenario.snapshot_eval?.enabled !== false)
              .map((scenario) => scenario.id)
          );
          const applied = applySnapshotPolicyToRunResult({
            results,
            comparisons: [comparison],
            policy,
            enabledScenarioIds
          });
          console.log('');
          console.log(kleur.cyan('📸 Snapshot Eval Policy'));
          console.log(
            `${applied.mode} · baseline=${applied.baseline_snapshot_id} · overall=${applied.overall_score} · status=${applied.status}`
          );
          if (applied.impacted_scenarios.length > 0) {
            console.log(
              kleur.yellow(`Impacted scenarios: ${applied.impacted_scenarios.join(', ')}`)
            );
          }
          console.log(formatSnapshotComparisonTable(comparison));
          shouldFailOnDrift =
            policy.mode === 'fail_on_drift' && applied.impacted_scenarios.length > 0;
        }
      }

      const reportPath = join(runDir, 'report.html');
      const resultsPath = join(runDir, 'results.json');
      writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
      writeFileSync(reportPath, renderReport(results), 'utf8');
      console.log(kleur.green(`Run completed: ${runDir}`));

      if (options.compareSnapshot) {
        const snapshot = loadSnapshot(
          String(options.compareSnapshot),
          resolve(options.snapshotsDir)
        );
        const comparison = compareRunToSnapshot(results, snapshot);
        console.log('');
        console.log(kleur.cyan('📸 Snapshot Comparison'));
        console.log(formatSnapshotComparisonTable(comparison));
      }

      // If multi-agent test, show comparison
      if (options.agents) {
        console.log(kleur.cyan(`\n📈 Run comparison script:`));
        console.log(
          kleur.gray(`   node scripts/compare-llm-results.mjs ${join(runDir, 'results.json')}`)
        );
      }
      if (shouldFailOnDrift) {
        console.error(kleur.red('Snapshot eval drift detected in fail_on_drift mode.'));
        process.exit(2);
      }
    } catch (err: any) {
      const message = err?.message ?? String(err);
      const hint = message.includes('fetch failed')
        ? ' Hint: verify the MCP server is running, the SSE URL is correct, and any bearer token env var is set.'
        : '';
      console.error(kleur.red(`Error: ${message}${hint}`));
      process.exit(1);
    }
  });

program
  .command('snapshot')
  .description('Manage evaluation snapshots')
  .addCommand(
    new Command('create')
      .description('Create snapshot from a run (only fully passing runs)')
      .requiredOption('--run <runId>', 'Run id from runs/<runId>')
      .option('--name <name>', 'Snapshot name')
      .option('--runs-dir <path>', 'Directory with run artifacts', 'mcplab/results/evaluation-runs')
      .option('--snapshots-dir <path>', 'Directory for snapshots', 'mcplab/snapshots')
      .action((options) => {
        try {
          const resultsPath = resolve(options.runsDir, String(options.run), 'results.json');
          const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
          const snapshot = buildSnapshotFromRun(results, options.name);
          const path = saveSnapshot(snapshot, resolve(options.snapshotsDir));
          console.log(kleur.green(`Snapshot created: ${snapshot.id}`));
          console.log(kleur.gray(`Path: ${path}`));
        } catch (err: any) {
          console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('eval-init')
      .description('Create baseline snapshot from a run and link it to config snapshot_eval policy')
      .requiredOption('--run <runId>', 'Run id from runs/<runId>')
      .requiredOption('--config <path>', 'Path to eval.yaml')
      .option('--name <name>', 'Snapshot name')
      .option('--runs-dir <path>', 'Directory with run artifacts', 'mcplab/results/evaluation-runs')
      .option('--snapshots-dir <path>', 'Directory for snapshots', 'mcplab/snapshots')
      .action((options) => {
        try {
          const resultsPath = resolve(options.runsDir, String(options.run), 'results.json');
          const results = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
          const snapshot = buildSnapshotFromRun(results, options.name);
          saveSnapshot(snapshot, resolve(options.snapshotsDir));

          const configPath = resolve(String(options.config));
          const { sourceConfig } = loadConfig(configPath);
          const nextConfig: SourceEvalConfig = {
            ...sourceConfig,
            snapshot_eval: {
              enabled: true,
              mode: sourceConfig.snapshot_eval?.mode ?? 'warn',
              baseline_snapshot_id: snapshot.id,
              baseline_source_run_id: results.metadata.run_id,
              last_updated_at: new Date().toISOString()
            }
          };
          writeFileSync(configPath, `${stringifyYaml(nextConfig)}\n`, 'utf8');

          console.log(kleur.green(`Snapshot eval baseline linked: ${snapshot.id}`));
          console.log(kleur.gray(`Config updated: ${configPath}`));
        } catch (err: any) {
          console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('eval-policy')
      .description('Update snapshot_eval policy in a config')
      .requiredOption('--config <path>', 'Path to eval.yaml')
      .requiredOption('--enabled <true|false>', 'Whether snapshot eval is enabled')
      .requiredOption('--mode <warn|fail_on_drift>', 'Snapshot eval mode')
      .option('--baseline-snapshot <snapshotId>', 'Baseline snapshot id')
      .option('--baseline-source-run <runId>', 'Source run id used to create baseline')
      .action((options) => {
        try {
          const enabled = String(options.enabled).toLowerCase() === 'true';
          const mode = String(options.mode) as 'warn' | 'fail_on_drift';
          if (mode !== 'warn' && mode !== 'fail_on_drift') {
            throw new Error('mode must be warn or fail_on_drift');
          }
          const configPath = resolve(String(options.config));
          const { sourceConfig } = loadConfig(configPath);
          const nextConfig: SourceEvalConfig = {
            ...sourceConfig,
            snapshot_eval: {
              enabled,
              mode,
              baseline_snapshot_id:
                options.baselineSnapshot ?? sourceConfig.snapshot_eval?.baseline_snapshot_id,
              baseline_source_run_id:
                options.baselineSourceRun ?? sourceConfig.snapshot_eval?.baseline_source_run_id,
              last_updated_at: new Date().toISOString()
            }
          };
          writeFileSync(configPath, `${stringifyYaml(nextConfig)}\n`, 'utf8');
          console.log(kleur.green(`Snapshot eval policy updated: ${configPath}`));
        } catch (err: any) {
          console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('eval-set-scenario')
      .description('Set or clear a scenario-level snapshot baseline override in a config')
      .requiredOption('--config <path>', 'Path to eval.yaml')
      .requiredOption('--scenario <id>', 'Scenario id')
      .option('--snapshot <snapshotId>', 'Override baseline snapshot id (omit to clear override)')
      .option('--source-run <runId>', 'Source run id used to create the scenario baseline')
      .option('--enabled <true|false>', 'Scenario snapshot eval enabled override')
      .action((options) => {
        try {
          const configPath = resolve(String(options.config));
          const scenarioId = String(options.scenario).trim();
          if (!scenarioId) throw new Error('scenario is required');
          const { sourceConfig } = loadConfig(configPath);
          const scenarios = [...(sourceConfig.scenarios ?? [])];
          const scenarioIndex = scenarios.findIndex(
            (s) => typeof s === 'object' && s !== null && !('ref' in s) && s.id === scenarioId
          );
          if (scenarioIndex < 0) {
            throw new Error(`Scenario not found in config.scenarios (inline only): ${scenarioId}`);
          }
          const current = scenarios[scenarioIndex];
          if (!current || typeof current !== 'object' || 'ref' in current) {
            throw new Error(`Scenario not found in config.scenarios (inline only): ${scenarioId}`);
          }
          const nextScenarioSnapshotEval = {
            ...(current.snapshot_eval ?? {}),
            ...(options.snapshot !== undefined
              ? { baseline_snapshot_id: String(options.snapshot || '') || undefined }
              : {}),
            ...(options.sourceRun !== undefined
              ? { baseline_source_run_id: String(options.sourceRun || '') || undefined }
              : {}),
            ...(options.enabled !== undefined
              ? { enabled: String(options.enabled).toLowerCase() === 'true' }
              : {}),
            last_updated_at: new Date().toISOString()
          };
          if (!nextScenarioSnapshotEval.baseline_snapshot_id) {
            delete (nextScenarioSnapshotEval as any).baseline_snapshot_id;
          }
          if (!nextScenarioSnapshotEval.baseline_source_run_id) {
            delete (nextScenarioSnapshotEval as any).baseline_source_run_id;
          }
          if (
            nextScenarioSnapshotEval.enabled === undefined &&
            !nextScenarioSnapshotEval.baseline_snapshot_id &&
            !nextScenarioSnapshotEval.baseline_source_run_id
          ) {
            scenarios[scenarioIndex] = {
              ...current,
              snapshot_eval: undefined
            };
          } else {
            scenarios[scenarioIndex] = {
              ...current,
              snapshot_eval: nextScenarioSnapshotEval
            };
          }
          const nextConfig: SourceEvalConfig = {
            ...sourceConfig,
            scenarios
          };
          writeFileSync(configPath, `${stringifyYaml(nextConfig)}\n`, 'utf8');
          console.log(
            kleur.green(
              `Scenario snapshot baseline ${options.snapshot ? 'set' : 'updated'}: ${scenarioId}`
            )
          );
          console.log(kleur.gray(`Config updated: ${configPath}`));
        } catch (err: any) {
          console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('list')
      .description('List snapshots')
      .option('--snapshots-dir <path>', 'Directory for snapshots', 'mcplab/snapshots')
      .action((options) => {
        try {
          const snapshots = listSnapshots(resolve(options.snapshotsDir));
          if (snapshots.length === 0) {
            console.log('No snapshots found.');
            return;
          }
          for (const snapshot of snapshots) {
            console.log(
              `${snapshot.id}  ${snapshot.name}  (run=${snapshot.source_run_id}, created=${snapshot.created_at})`
            );
          }
        } catch (err: any) {
          console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('show')
      .description('Show snapshot JSON')
      .requiredOption('--id <snapshotId>', 'Snapshot id')
      .option('--snapshots-dir <path>', 'Directory for snapshots', 'mcplab/snapshots')
      .action((options) => {
        try {
          const snapshot = loadSnapshot(String(options.id), resolve(options.snapshotsDir));
          console.log(JSON.stringify(snapshot, null, 2));
        } catch (err: any) {
          console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('compare')
      .description('Compare run against snapshot')
      .requiredOption('--id <snapshotId>', 'Snapshot id')
      .requiredOption('--run <runId>', 'Run id from runs/<runId>')
      .option('--format <format>', 'Output format: table|json', 'table')
      .option('--runs-dir <path>', 'Directory with run artifacts', 'mcplab/results/evaluation-runs')
      .option('--snapshots-dir <path>', 'Directory for snapshots', 'mcplab/snapshots')
      .action((options) => {
        try {
          const snapshot = loadSnapshot(String(options.id), resolve(options.snapshotsDir));
          const resultsPath = resolve(options.runsDir, String(options.run), 'results.json');
          const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
          const comparison = compareRunToSnapshot(results, snapshot);
          if (String(options.format) === 'json') {
            console.log(JSON.stringify(comparison, null, 2));
          } else {
            console.log(formatSnapshotComparisonTable(comparison));
          }
        } catch (err: any) {
          console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
          process.exit(1);
        }
      })
  );

program
  .command('migrate-configs')
  .description('Migrate eval YAML files to the canonical list-based format')
  .option('--evals-dir <path>', 'Directory for YAML evals', 'mcplab/evals')
  .option('--dry-run', 'Preview migration without writing files')
  .action((options) => {
    try {
      const evalsDir = resolve(String(options.evalsDir));
      const bundleRoot = resolve(evalsDir, '..');
      const files = readdirSync(evalsDir).filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'));
      let migrated = 0;
      let skipped = 0;
      let failed = 0;

      for (const file of files) {
        const filePath = resolve(evalsDir, file);
        try {
          const { sourceConfig, warnings } = loadConfig(filePath, { bundleRoot });
          const hadLegacyServersMapWarning = warnings.some((warning) =>
            warning.includes('Legacy servers object map was migrated')
          );
          const hadLegacyAgentsMapWarning = warnings.some((warning) =>
            warning.includes('Legacy agents object map was migrated')
          );
          const hadLegacyInlineIdsWarning = warnings.some(
            (warning) =>
              warning.includes('Legacy inline server.name migrated') ||
              warning.includes('Legacy inline agent.name migrated')
          );

          if (
            !hadLegacyServersMapWarning &&
            !hadLegacyAgentsMapWarning &&
            !hadLegacyInlineIdsWarning
          ) {
            skipped += 1;
            continue;
          }
          if (options.dryRun) {
            console.log(
              kleur.cyan(
                `[dry-run] ${file}: would normalize config format${warnings.length ? ` (${warnings.join(' | ')})` : ''}`
              )
            );
            migrated += 1;
            continue;
          }
          const nextConfig: SourceEvalConfig = { ...sourceConfig };
          writeFileSync(filePath, `${stringifyYaml(nextConfig)}\n`, 'utf8');
          migrated += 1;
          console.log(kleur.green(`Migrated: ${file}`));
        } catch (error: any) {
          failed += 1;
          console.error(kleur.red(`Failed: ${file} (${error?.message ?? String(error)})`));
        }
      }
      console.log(
        kleur.cyan(
          `Migration summary${options.dryRun ? ' (dry-run)' : ''}: migrated=${migrated}, skipped=${skipped}, failed=${failed}`
        )
      );
    } catch (err: any) {
      console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
      process.exit(1);
    }
  });

program
  .command('report')
  .description('Regenerate report.html from a previous run')
  .requiredOption('--input <runDir>', 'Run directory containing results.json')
  .action((options) => {
    try {
      const runDir = resolve(options.input);
      const resultsPath = join(runDir, 'results.json');
      const reportPath = join(runDir, 'report.html');
      const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
      const html = renderReport(results);
      writeFileSync(reportPath, html, 'utf8');
      console.log(kleur.green(`Report regenerated: ${reportPath}`));
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error(kleur.red(`Error: ${message}`));
      process.exit(1);
    }
  });

program
  .command('app')
  .description('Serve MCPLab app frontend and local API bridge')
  .option('--evals-dir <path>', 'Directory for YAML evals', 'mcplab/evals')
  .option('--runs-dir <path>', 'Directory for run artifacts', 'mcplab/results/evaluation-runs')
  .option('--snapshots-dir <path>', 'Directory for snapshot artifacts', 'mcplab/snapshots')
  .option(
    '--tool-analysis-results-dir <path>',
    'Directory for saved tool analysis reports',
    'mcplab/results/tool-analysis'
  )
  .option('--libraries-dir <path>', 'Bundle root for reusable servers/agents/scenarios', 'mcplab')
  .option('--port <number>', 'Port to bind', '8787')
  .option('--host <host>', 'Host to bind', '127.0.0.1')
  .option('--open', 'Open browser after startup')
  .option('--dev', 'Proxy frontend requests to Vite dev server (API remains local)')
  .action(async (options) => {
    try {
      const port = Number(options.port);
      if (Number.isNaN(port) || port <= 0) {
        throw new Error('Port must be a positive number');
      }
      await startAppServer({
        host: options.host,
        port,
        evalsDir: resolve(options.evalsDir),
        runsDir: resolve(options.runsDir),
        snapshotsDir: resolve(options.snapshotsDir),
        toolAnalysisResultsDir: resolve(options.toolAnalysisResultsDir),
        librariesDir: resolve(options.librariesDir),
        dev: Boolean(options.dev),
        open: Boolean(options.open)
      });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error(kleur.red(`Error: ${message}`));
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('Watch config file and auto-rerun evaluations on changes')
  .requiredOption('-c, --config <path>', 'Path to eval.yaml')
  .option('-s, --scenario <id>', 'Run a single scenario')
  .option('-n, --runs <count>', 'Variance runs', '1')
  .option('--runs-dir <path>', 'Directory for run artifacts', 'mcplab/results/evaluation-runs')
  .option('--debounce <ms>', 'Debounce delay in milliseconds', '500')
  .action(async (options) => {
    const configPath = resolve(options.config);
    const runsPerScenario = Number(options.runs);
    const debounceMs = Number(options.debounce);

    if (Number.isNaN(runsPerScenario) || runsPerScenario <= 0) {
      console.error(kleur.red('Error: Runs must be a positive number'));
      process.exit(1);
    }

    console.log(kleur.cyan(`👀 Watching: ${configPath}`));
    console.log(kleur.gray(`Press Ctrl+C to stop\n`));

    let running = false;
    let debounceTimer: NodeJS.Timeout | null = null;

    const runEvaluation = async () => {
      if (running) {
        console.log(kleur.yellow('⏭️  Evaluation already running, skipping...'));
        return;
      }

      running = true;
      const timestamp = new Date().toLocaleTimeString();
      console.log(kleur.cyan(`\n⚡ [${timestamp}] Running evaluation...`));

      try {
        const { config, hash } = loadConfig(configPath);
        const expanded = expandConfigForAgents(config, config.run_defaults?.selected_agents);
        const selected = selectScenarios(expanded, options.scenario);
        const { runDir, results } = await runAll(selected, {
          runsPerScenario,
          scenarioId: options.scenario,
          configHash: hash,
          gitCommit: getGitCommit(),
          cliVersion: pkgVersion,
          runsDir: String(options.runsDir)
        });
        const reportPath = join(runDir, 'report.html');
        writeFileSync(reportPath, renderReport(results), 'utf8');
        console.log(kleur.green(`✅ Run completed: ${runDir}`));
      } catch (err: any) {
        const message = err?.message ?? String(err);
        const hint = message.includes('fetch failed')
          ? ' Hint: verify the MCP server is running, the SSE URL is correct, and any bearer token env var is set.'
          : '';
        console.error(kleur.red(`❌ Error: ${message}${hint}`));
      } finally {
        running = false;
      }
    };

    // Initial run
    await runEvaluation();

    // Watch for changes
    const watcher = chokidar.watch(configPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    });

    watcher.on('change', () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        runEvaluation();
      }, debounceMs);
    });

    watcher.on('error', (error) => {
      console.error(kleur.red(`Watcher error: ${error}`));
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(kleur.cyan('\n\n👋 Stopping watcher...'));
      watcher.close();
      process.exit(0);
    });
  });

program.parse();

function getGitCommit(): string | undefined {
  try {
    const output = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}
