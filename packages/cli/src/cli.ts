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
  renderSummaryMarkdown,
  expandConfigForAgents,
  type EvalConfig,
  type SourceEvalConfig,
  type ExecutableEvalConfig,
  type ResultsJson,
  type RunProgressEvent
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import { execSync } from 'node:child_process';
import { stringify as stringifyYaml, parse } from 'yaml';
import { startAppServer } from './app-server/index.js';
import { migrateSourceConfig } from './migrate-utils.js';
import { resolveRunOptions, runInteractiveSelection } from './run-interactive.js';
import { promptAppOptionsInteractive, selectRunDirInteractive } from './interactive-helpers.js';
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
  .option('-c, --config <path>', 'Path to eval.yaml')
  .option('-s, --scenario <id>', 'Run a single scenario')
  .option('-n, --runs <count>', 'Variance runs', '1')
  .option(
    '--agents <agents>',
    'Comma-separated list of agents to test (runs each scenario with each agent)'
  )
  .option('--agents-all', 'Run all configured agents for the selected scenarios')
  .option('--interactive', 'Prompt for required inputs')
  .option('--snapshot-eval', 'Apply snapshot eval policy configured in the config')
  .option('--compare-snapshot <snapshotId>', 'Compare completed run against snapshot id')
  .option('--run-note <text>', 'Optional note attached to the run metadata (max 500 chars)')
  .option('--runs-dir <path>', 'Directory for run artifacts', 'mcplab/results/evaluation-runs')
  .option('--snapshots-dir <path>', 'Directory for snapshots', 'mcplab/snapshots')
  .action(async (options) => {
    try {
      const hasAgentOverride = Boolean(options.agents) || Boolean(options.agentsAll);
      const needsConfigPrompt = Boolean(options.interactive) && !options.config;
      const needsAgentPrompt = Boolean(options.interactive) && !hasAgentOverride;
      const interactiveSelection =
        needsConfigPrompt || needsAgentPrompt
          ? await runInteractiveSelection({
              initialConfigPath: options.config ? String(options.config) : undefined,
              defaultEvalsDir: 'mcplab/evals',
              cwd: process.cwd(),
              promptAgentSelection: needsAgentPrompt,
              loadConfigForValidation: (path: string) => loadConfig(path)
            })
          : undefined;

      const resolvedOptions = resolveRunOptions({
        interactive: Boolean(options.interactive),
        config: options.config ? String(options.config) : undefined,
        agents: options.agents ? String(options.agents) : undefined,
        agentsAll: Boolean(options.agentsAll),
        interactiveSelection
      });

      let { config, hash, warnings } = loadConfig(resolve(resolvedOptions.config));
      for (const warning of warnings) {
        console.log(kleur.yellow(`⚠ ${warning}`));
      }

      const requestedAgentsFromCsv = resolvedOptions.agents
        ? resolvedOptions.agents
            .split(',')
            .map((a: string) => a.trim())
            .filter(Boolean)
        : [];
      const requestedAgents = resolvedOptions.agentsAll
        ? Object.keys(config.agents)
        : requestedAgentsFromCsv.length > 0
        ? requestedAgentsFromCsv
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
      const runNoteRaw = typeof options.runNote === 'string' ? String(options.runNote).trim() : '';
      const runNote = runNoteRaw ? runNoteRaw.slice(0, 500) : undefined;
      const { runDir, results } = await runAll(selected, {
        runsPerScenario,
        scenarioId: options.scenario,
        runNote,
        configHash: hash,
        gitCommit: getGitCommit(),
        cliVersion: pkgVersion,
        runsDir: String(options.runsDir),
        onProgress: async (event) => {
          const line = formatRunProgressEvent(event);
          if (line) {
            console.log(`[${formatNowTime()}] ${line}`);
          }
        }
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
      const summaryPath = join(runDir, 'summary.md');
      writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
      writeFileSync(reportPath, renderReport(results), 'utf8');
      writeFileSync(summaryPath, renderSummaryMarkdown(results), 'utf8');
      console.log(kleur.green(`✅ Run complete. Results: ${runDir}`));

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

      if (shouldFailOnDrift) {
        console.error(kleur.red('Snapshot eval drift detected in fail_on_drift mode.'));
        process.exit(2);
      }
      console.log(kleur.gray('Process exiting.'));
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
  .option('--test-cases-dir <path>', 'Also migrate test-case YAML files in this directory', '')
  .action((options) => {
    try {
      const evalsDir = resolve(String(options.evalsDir));
      const bundleRoot = resolve(evalsDir, '..');
      const files = readdirSync(evalsDir).filter(
        (name) => name.endsWith('.yaml') || name.endsWith('.yml')
      );
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
          const hasScenariosWithLegacyServers = sourceConfig.scenarios.some(
            (s) =>
              !('ref' in s) &&
              Array.isArray((s as any).servers) &&
              (s as any).servers.length > 0 &&
              typeof (s as any).servers[0] === 'string' &&
              !(s as any).mcp_servers
          );

          if (
            !hadLegacyServersMapWarning &&
            !hadLegacyAgentsMapWarning &&
            !hadLegacyInlineIdsWarning &&
            !hasScenariosWithLegacyServers
          ) {
            skipped += 1;
            continue;
          }
          if (options.dryRun) {
            console.log(
              kleur.cyan(
                `[dry-run] ${file}: would normalize config format${
                  warnings.length ? ` (${warnings.join(' | ')})` : ''
                }`
              )
            );
            migrated += 1;
            continue;
          }
          const nextConfig = migrateSourceConfig(sourceConfig);
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
          `Migration summary${
            options.dryRun ? ' (dry-run)' : ''
          }: migrated=${migrated}, skipped=${skipped}, failed=${failed}`
        )
      );
      if (!options.testCasesDir) {
        console.log(
          kleur.yellow(
            'Note: if referenced test-cases still use legacy servers: [...], run with --test-cases-dir <path> to migrate them too.'
          )
        );
      }

      if (options.testCasesDir) {
        const testCasesDir = resolve(String(options.testCasesDir));
        let tcMigrated = 0;
        let tcSkipped = 0;
        let tcFailed = 0;
        let tcFiles: string[] = [];
        try {
          tcFiles = readdirSync(testCasesDir).filter(
            (name: string) => name.endsWith('.yaml') || name.endsWith('.yml')
          );
        } catch {
          console.error(kleur.red(`Could not read test-cases-dir: ${testCasesDir}`));
        }
        for (const file of tcFiles) {
          const filePath = resolve(testCasesDir, file);
          try {
            const raw = readFileSync(filePath, 'utf8');
            const parsed = parse(raw) as any;
            if (!parsed || typeof parsed !== 'object') {
              tcSkipped += 1;
              continue;
            }
            const hasLegacyServers =
              Array.isArray(parsed.servers) &&
              parsed.servers.length > 0 &&
              typeof parsed.servers[0] === 'string' &&
              !parsed.mcp_servers;
            if (!hasLegacyServers) {
              tcSkipped += 1;
              continue;
            }
            if (options.dryRun) {
              console.log(
                kleur.cyan(`[dry-run] test-case ${file}: would migrate servers to mcp_servers`)
              );
              tcMigrated += 1;
              continue;
            }
            const { servers: legacyServers, ...rest } = parsed;
            const migrated = {
              ...rest,
              mcp_servers: legacyServers.map((id: string) => ({ ref: id }))
            };
            writeFileSync(filePath, `${stringifyYaml(migrated)}\n`, 'utf8');
            tcMigrated += 1;
            console.log(kleur.green(`Migrated test-case: ${file}`));
          } catch (error: any) {
            tcFailed += 1;
            console.error(
              kleur.red(`Failed test-case: ${file} (${error?.message ?? String(error)})`)
            );
          }
        }
        console.log(
          kleur.cyan(
            `Test-cases migration${
              options.dryRun ? ' (dry-run)' : ''
            }: migrated=${tcMigrated}, skipped=${tcSkipped}, failed=${tcFailed}`
          )
        );
      }
    } catch (err: any) {
      console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
      process.exit(1);
    }
  });

program
  .command('report')
  .description('Regenerate report.html from a previous run')
  .option('--input <runDir>', 'Run directory containing results.json')
  .option('--runs-dir <path>', 'Directory with run artifacts', 'mcplab/results/evaluation-runs')
  .option('--interactive', 'Pick a run directory interactively')
  .action(async (options) => {
    try {
      const runDir = options.interactive
        ? options.input
          ? resolve(String(options.input))
          : await selectRunDirInteractive({
              runsDir: String(options.runsDir),
              cwd: process.cwd()
            })
        : options.input
        ? resolve(String(options.input))
        : (() => {
            throw new Error('input is required');
          })();
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
  .option('--libraries-dir <path>', 'Bundle root for reusable servers/agents/test-cases', 'mcplab')
  .option('--port <number>', 'Port to bind', '8787')
  .option('--host <host>', 'Host to bind', '127.0.0.1')
  .option('--open', 'Open browser after startup')
  .option('--dev', 'Proxy frontend requests to Vite dev server (API remains local)')
  .option('--interactive', 'Prompt for host/port/paths before startup')
  .action(async (options) => {
    try {
      const resolvedAppOptions = options.interactive
        ? await promptAppOptionsInteractive({
            host: String(options.host),
            port: String(options.port),
            evalsDir: String(options.evalsDir),
            runsDir: String(options.runsDir),
            snapshotsDir: String(options.snapshotsDir),
            toolAnalysisResultsDir: String(options.toolAnalysisResultsDir),
            librariesDir: String(options.librariesDir)
          })
        : {
            host: String(options.host),
            port: String(options.port),
            evalsDir: String(options.evalsDir),
            runsDir: String(options.runsDir),
            snapshotsDir: String(options.snapshotsDir),
            toolAnalysisResultsDir: String(options.toolAnalysisResultsDir),
            librariesDir: String(options.librariesDir)
          };

      const port = Number(resolvedAppOptions.port);
      if (Number.isNaN(port) || port <= 0) {
        throw new Error('Port must be a positive number');
      }
      await startAppServer({
        host: resolvedAppOptions.host,
        port,
        evalsDir: resolve(resolvedAppOptions.evalsDir),
        runsDir: resolve(resolvedAppOptions.runsDir),
        snapshotsDir: resolve(resolvedAppOptions.snapshotsDir),
        toolAnalysisResultsDir: resolve(resolvedAppOptions.toolAnalysisResultsDir),
        librariesDir: resolve(resolvedAppOptions.librariesDir),
        dev: Boolean(options.dev),
        open: Boolean(options.open)
      });
    } catch (err: any) {
      const message = err?.message ?? String(err);
      console.error(kleur.red(`Error: ${message}`));
      process.exit(1);
    }
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

function formatNowTime(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function formatRunProgressEvent(event: RunProgressEvent): string | undefined {
  switch (event.type) {
    case 'run_started':
      return `Run started (${event.totalScenarioRuns} scenario run(s), ${event.runsPerScenario} run(s) each).`;
    case 'mcp_connect_started':
      return `Connecting MCP servers (${event.serverCount})...`;
    case 'mcp_connect_finished':
      return `Connected MCP servers (${event.serverCount}).`;
    case 'scenario_run_started':
      return `Scenario ${event.scenarioRunIndex}/${event.totalScenarioRuns} started: ${
        event.scenarioId
      } [agent=${event.agentName}, run=${event.runIndex + 1}/${event.runsPerScenario}]`;
    case 'scenario_run_finished':
      return `Scenario ${event.scenarioRunIndex}/${event.totalScenarioRuns} finished: ${
        event.scenarioId
      } [agent=${event.agentName}] -> ${event.pass ? 'PASS' : 'FAIL'} (${
        event.toolCallCount
      } tool calls)`;
    case 'run_finished':
      return `Run finished: ${event.runId}`;
    default:
      return undefined;
  }
}
