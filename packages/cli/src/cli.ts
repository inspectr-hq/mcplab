#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config();
import { Command } from 'commander';
import kleur from 'kleur';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  loadConfig,
  hashConfig,
  selectScenarios,
  runAll,
  renderSummaryMarkdown,
  expandConfigForAgents,
  applyRuntimeServerOverrides,
  type EvalConfig,
  type SourceEvalConfig,
  type ExecutableEvalConfig,
  type ResultsJson,
  type RunProgressEvent
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import { execSync, spawn } from 'node:child_process';
import { stringify as stringifyYaml, parse } from 'yaml';
import { startAppServer } from './app-server/index.js';
import { readLibraries } from './app-server/libraries-store.js';
import { migrateSourceConfig } from './migrate-utils.js';
import {
  resolveRunOptions,
  runInteractiveSelection,
  type ResolveRunOptionsResult
} from './run-interactive.js';
import { promptAppOptionsInteractive, selectRunDirInteractive } from './interactive-helpers.js';
import { deriveConfigRelativePath, resolveRunConfigSelection } from './eval-config-files.js';
import { loadOrBuildSearchIndex } from './results/indexer.js';
import { searchDocs } from './results/search.js';
import {
  formatContext,
  formatRunList,
  formatSearchHits,
  listRuns,
  showRun
} from './results/format.js';
import type { ResultSource } from './results/types.js';
import { getContext } from './results/context.js';

const pkgVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  ?.version as string;

const program = new Command();
program
  .name('mcplab')
  .description('Laboratory for testing Model Context Protocol servers')
  .version(pkgVersion)
  .option(
    '--no-prune-failed-runs-on-start',
    'Disable startup cleanup of old failed run folders (env override: MCPLAB_PRUNE_FAILED_RUNS_ON_START=0)'
  );

program.hook('preAction', (_thisCommand, actionCommand) => {
  try {
    pruneFailedRunsOnStartIfEnabled(actionCommand);
  } catch (err: any) {
    console.error(
      kleur.yellow(
        `Warning: failed to prune runs on startup: ${err?.message ?? String(err)}. Continuing.`
      )
    );
  }
});

interface RunCommandOptions {
  config?: string;
  scenario?: string;
  runs: string;
  agents?: string;
  agentsAll: boolean;
  interactive: boolean;
  bail: boolean;
  runNote?: string;
  runsDir: string;
  oauthToken: string[];
  openBrowser: boolean;
  serverOverrideAll?: string;
  serverOverride: string[];
}

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
  .option('--bail', 'Stop after first failed config when --config points to a folder')
  .option('--run-note <text>', 'Optional note attached to the run metadata (max 500 chars)')
  .option('--runs-dir <path>', 'Directory for run artifacts', 'mcplab/results/evaluation-runs')
  .option(
    '--oauth-token <server=token>',
    'Pre-obtained OAuth Bearer token for a server (repeatable, format: server-name=token)',
    (val: string, acc: string[]) => [...acc, val],
    [] as string[]
  )
  .option(
    '--open-browser',
    'Open browser to mcplab serve UI when OAuth is required (default: print URL only)'
  )
  .option(
    '--server-override-all <serverRef[,serverRef...]>',
    'Override MCP server refs for all selected scenarios for this run only'
  )
  .option(
    '--server-override <scenarioId=serverRef[,serverRef...]>',
    'Override MCP server refs for one scenario (repeatable, higher priority than --server-override-all)',
    (val: string, acc: string[]) => [...acc, val],
    [] as string[]
  )
  .action(async (options: RunCommandOptions) => {
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
              loadConfigForValidation: (path: string) => {
                const loaded = loadConfig(path);
                const { agents: libraryAgents, servers: libraryServers } = readLibraries(
                  loaded.bundleRoot
                );
                loaded.config = {
                  ...loaded.config,
                  agents: { ...libraryAgents, ...loaded.config.agents },
                  servers: { ...libraryServers, ...loaded.config.servers }
                };
                return loaded;
              }
            })
          : undefined;

      const resolvedOptions = resolveRunOptions({
        interactive: Boolean(options.interactive),
        config: options.config ? String(options.config) : undefined,
        agents: options.agents ? String(options.agents) : undefined,
        agentsAll: Boolean(options.agentsAll),
        interactiveSelection
      });

      const selection = resolveRunConfigSelection(resolvedOptions.config, process.cwd());
      const configPaths = selection.configPaths;
      const requestedPath = selection.requestedPath;
      const requestedPathIsDirectory = selection.requestedPathIsDirectory;
      const isBatch = requestedPathIsDirectory;

      if (!isBatch) {
        await executeSingleConfigRun({
          configPath: configPaths[0]!,
          options,
          resolvedOptions
        });
        console.log(kleur.gray('Process exiting.'));
        return;
      }

      const rows: Array<{
        configPath: string;
        runId?: string;
        runDir?: string;
        success: boolean;
        error?: string;
      }> = [];
      let hadFailures = false;
      for (let i = 0; i < configPaths.length; i += 1) {
        const configPath = configPaths[i]!;
        const displayPath = deriveConfigRelativePath(configPath, requestedPath);
        console.log(kleur.cyan(`\n▶ Batch config ${i + 1}/${configPaths.length}: ${displayPath}`));
        try {
          const outcome = await executeSingleConfigRun({
            configPath,
            options,
            resolvedOptions
          });
          const success = outcome.passed && !outcome.shouldFailOnDrift;
          rows.push({
            configPath: displayPath,
            runId: outcome.runId,
            runDir: outcome.runDir,
            success
          });
          if (!success) {
            hadFailures = true;
            if (options.bail) {
              console.error(kleur.red('Stopping batch due to --bail after failed config.'));
              break;
            }
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          rows.push({
            configPath: displayPath,
            success: false,
            error: message
          });
          hadFailures = true;
          if (options.bail) {
            console.error(kleur.red('Stopping batch due to --bail after config error.'));
            break;
          }
        }
      }

      console.log('');
      console.log(kleur.cyan('Batch summary:'));
      for (const row of rows) {
        if (row.success) {
          console.log(
            kleur.green(
              `  ✓ ${row.configPath} (run=${row.runId ?? '-'}${
                row.runDir ? `, dir=${relative(process.cwd(), row.runDir)}` : ''
              })`
            )
          );
        } else {
          console.log(kleur.red(`  ✗ ${row.configPath}${row.error ? ` (${row.error})` : ''}`));
        }
      }
      console.log(
        kleur.cyan(
          `Batch result: ${rows.filter((row) => row.success).length} succeeded, ${
            rows.filter((row) => !row.success).length
          } failed`
        )
      );

      if (hadFailures) {
        process.exit(1);
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
  .command('results')
  .description('Query evaluation run artifacts for LLM-first workflows')
  .addCommand(
    new Command('list')
      .description('List available evaluation runs')
      .option('--runs-dir <path>', 'Directory for run artifacts', 'mcplab/results/evaluation-runs')
      .option('--format <format>', 'Output format: table|json', 'table')
      .action((options) => {
        try {
          const format = String(options.format) === 'json' ? 'json' : 'table';
          const rows = listRuns(resolve(String(options.runsDir)));
          console.log(formatRunList(rows, format));
        } catch (err: any) {
          console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('show')
      .description('Show run results in json or markdown')
      .requiredOption('--run <runId>', 'Run id under runs dir')
      .option('--runs-dir <path>', 'Directory for run artifacts', 'mcplab/results/evaluation-runs')
      .option('--format <format>', 'Output format: json|markdown', 'json')
      .action((options) => {
        try {
          const format = String(options.format) === 'markdown' ? 'markdown' : 'json';
          const output = showRun(resolve(String(options.runsDir)), String(options.run), format);
          console.log(output);
        } catch (err: any) {
          console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('index')
      .description('Build or refresh local results search index')
      .option('--runs-dir <path>', 'Directory for run artifacts', 'mcplab/results/evaluation-runs')
      .option('--rebuild', 'Force full rebuild')
      .action((options) => {
        try {
          const runsDir = resolve(String(options.runsDir));
          const docs = loadOrBuildSearchIndex(runsDir, Boolean(options.rebuild));
          console.log(kleur.green(`Indexed ${docs.length} searchable docs.`));
        } catch (err: any) {
          console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('search')
      .description('Search run artifacts and return compact structured hits')
      .argument('<query>', 'Search query')
      .option('--runs-dir <path>', 'Directory for run artifacts', 'mcplab/results/evaluation-runs')
      .option('--status <status>', 'Filter: passed|failed|all', 'all')
      .option('--agent <agent>', 'Filter by agent id')
      .option('--scenario <id>', 'Filter by scenario id')
      .option(
        '--source <sources>',
        'Comma-separated sources: results,trace,summary',
        'results,trace,summary'
      )
      .option('--limit <n>', 'Maximum results', '10')
      .option('--format <format>', 'Output format: json|jsonl|markdown', 'json')
      .action((query, options) => {
        try {
          const queryText = String(query).trim();
          if (!queryText) {
            throw new Error('query must not be empty');
          }
          const status = String(options.status) as 'passed' | 'failed' | 'all';
          if (!['passed', 'failed', 'all'].includes(status)) {
            throw new Error('status must be passed, failed, or all');
          }
          const source = String(options.source ?? '')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean) as ResultSource[];
          if (source.length === 0) {
            throw new Error('source must include at least one of results, trace, summary');
          }
          const sourceSet = new Set(source);
          for (const value of sourceSet) {
            if (!['results', 'trace', 'summary'].includes(value)) {
              throw new Error(`invalid source: ${value}`);
            }
          }
          const limit = Number(options.limit);
          if (Number.isNaN(limit) || limit <= 0) {
            throw new Error('limit must be a positive number');
          }
          const format = String(options.format);
          if (!['json', 'jsonl', 'markdown'].includes(format)) {
            throw new Error('format must be json, jsonl, or markdown');
          }
          const runsDir = resolve(String(options.runsDir));
          const docs = loadOrBuildSearchIndex(runsDir, false);
          const hits = searchDocs(docs, {
            query: queryText,
            limit,
            status,
            source: [...sourceSet],
            scenario: options.scenario ? String(options.scenario) : undefined,
            agent: options.agent ? String(options.agent) : undefined
          });
          console.log(formatSearchHits(hits, format as 'json' | 'jsonl' | 'markdown'));
        } catch (err: any) {
          console.error(kleur.red(`Error: ${err?.message ?? String(err)}`));
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('context')
      .description('Fetch focused context for a scenario/run')
      .requiredOption('--run <runId>', 'Run id under runs dir')
      .requiredOption('--scenario <id>', 'Scenario id')
      .option('--runs-dir <path>', 'Directory for run artifacts', 'mcplab/results/evaluation-runs')
      .option('--source <source>', 'Source: results|trace|summary')
      .option('--around <line>', 'Trace line to center context around')
      .option('--before <n>', 'Lines before around line', '20')
      .option('--after <n>', 'Lines after around line', '20')
      .option('--format <format>', 'Output format: json|markdown', 'markdown')
      .action((options) => {
        try {
          const sourceRaw = options.source ? String(options.source) : undefined;
          if (sourceRaw && !['results', 'trace', 'summary'].includes(sourceRaw)) {
            throw new Error('source must be results, trace, or summary');
          }
          const around = options.around !== undefined ? Number(options.around) : undefined;
          if (around !== undefined && (Number.isNaN(around) || around <= 0)) {
            throw new Error('around must be a positive integer');
          }
          if (around !== undefined && sourceRaw && sourceRaw !== 'trace') {
            throw new Error('around can only be used when source=trace');
          }
          const before = Number(options.before);
          const after = Number(options.after);
          if (Number.isNaN(before) || before < 0 || Number.isNaN(after) || after < 0) {
            throw new Error('before/after must be non-negative integers');
          }
          const result = getContext({
            runsDir: resolve(String(options.runsDir)),
            runId: String(options.run),
            scenarioId: String(options.scenario),
            source: sourceRaw as ResultSource | undefined,
            around,
            before,
            after
          });
          const format = String(options.format);
          if (!['json', 'markdown'].includes(format)) {
            throw new Error('format must be json or markdown');
          }
          console.log(formatContext(result, format as 'json' | 'markdown'));
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
            toolAnalysisResultsDir: String(options.toolAnalysisResultsDir),
            librariesDir: String(options.librariesDir)
          })
        : {
            host: String(options.host),
            port: String(options.port),
            evalsDir: String(options.evalsDir),
            runsDir: String(options.runsDir),
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

function openBrowserUrl(url: string): void {
  const platform = process.platform;
  if (platform === 'win32') {
    // 'start' is a cmd.exe builtin — must invoke via cmd /c
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
  } else {
    const cmd = platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
  }
}

function parseRuntimeServerOverrides(options: RunCommandOptions): {
  serverOverrideAll?: string[];
  scenarioServerOverrides?: Record<string, string[]>;
} {
  const serverOverrideAll = options.serverOverrideAll
    ? options.serverOverrideAll
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : undefined;
  if (
    options.serverOverrideAll !== undefined &&
    (!serverOverrideAll || serverOverrideAll.length === 0)
  ) {
    throw new Error('serverOverrideAll must include at least one server id');
  }
  const scenarioServerOverrides: Record<string, string[]> = {};
  for (const rawEntry of options.serverOverride) {
    const entry = String(rawEntry ?? '').trim();
    const eqIdx = entry.indexOf('=');
    if (eqIdx < 1) {
      throw new Error(
        `Invalid --server-override format '${entry}'. Expected: <scenarioId>=<serverRef[,serverRef...]>`
      );
    }
    const scenarioId = entry.slice(0, eqIdx).trim();
    const csv = entry.slice(eqIdx + 1);
    if (!scenarioId) {
      throw new Error(`Invalid --server-override '${entry}': scenario id cannot be empty`);
    }
    const parsedServerIds = csv
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (parsedServerIds.length === 0) {
      throw new Error(
        `Invalid --server-override '${entry}': must include at least one server id after '='`
      );
    }
    scenarioServerOverrides[scenarioId] = parsedServerIds;
  }
  return {
    serverOverrideAll,
    scenarioServerOverrides:
      Object.keys(scenarioServerOverrides).length > 0 ? scenarioServerOverrides : undefined
  };
}

function filterRuntimeOverridesToSelectedScenarios(
  selectedConfig: EvalConfig,
  overrides: {
    serverOverrideAll?: string[];
    scenarioServerOverrides?: Record<string, string[]>;
  }
): {
  serverOverrideAll?: string[];
  scenarioServerOverrides?: Record<string, string[]>;
} {
  if (!overrides.scenarioServerOverrides) return overrides;
  const selectedIds = new Set(selectedConfig.scenarios.map((scenario) => scenario.id));
  const filtered = Object.fromEntries(
    Object.entries(overrides.scenarioServerOverrides).filter(([scenarioId]) =>
      selectedIds.has(scenarioId)
    )
  );
  return {
    ...overrides,
    scenarioServerOverrides: Object.keys(filtered).length > 0 ? filtered : undefined
  };
}

async function executeSingleConfigRun(params: {
  configPath: string;
  options: RunCommandOptions;
  resolvedOptions: ResolveRunOptionsResult;
}): Promise<{ runDir: string; runId: string; passed: boolean; shouldFailOnDrift: boolean }> {
  const { configPath, options, resolvedOptions } = params;
  const loaded = loadConfig(resolve(configPath));
  const { agents: libraryAgents, servers: libraryServers } = readLibraries(loaded.bundleRoot);
  loaded.config = {
    ...loaded.config,
    agents: { ...libraryAgents, ...loaded.config.agents },
    servers: { ...libraryServers, ...loaded.config.servers }
  };
  loaded.hash = hashConfig(loaded.config);
  const { config, warnings } = loaded;
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
  const runtimeOverrides = parseRuntimeServerOverrides(options);
  const selectedBaseConfig = options.scenario ? selectScenarios(config, options.scenario) : config;
  const selectedOverrides = filterRuntimeOverridesToSelectedScenarios(
    selectedBaseConfig,
    runtimeOverrides
  );
  const runtimeOverriddenConfig = applyRuntimeServerOverrides(
    selectedBaseConfig,
    selectedOverrides
  );
  const effectiveConfigHash = hashConfig(runtimeOverriddenConfig);
  const beforeExpandCount = runtimeOverriddenConfig.scenarios.length;
  const effectiveAgents = requestedAgents ?? runtimeOverriddenConfig.run_defaults?.selected_agents;
  const expanded = expandConfigForAgents(runtimeOverriddenConfig, effectiveAgents);
  if (expanded.scenarios.length !== beforeExpandCount || effectiveAgents?.length) {
    const agentCount = effectiveAgents?.length ?? Object.keys(config.agents).length;
    console.log(
      kleur.cyan(
        `📊 Testing ${beforeExpandCount} scenarios × ${agentCount} selected agents = ${expanded.scenarios.length} total tests`
      )
    );
  }

  const runsPerScenario = Number(options.runs);
  if (Number.isNaN(runsPerScenario) || runsPerScenario <= 0) {
    throw new Error('Runs must be a positive number');
  }
  const runNoteRaw = typeof options.runNote === 'string' ? String(options.runNote).trim() : '';
  const runNote = runNoteRaw ? runNoteRaw.slice(0, 500) : undefined;
  const oauthTokens: Record<string, string> = {};
  for (const entry of options.oauthToken) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx < 1) {
      throw new Error(`Invalid --oauth-token format '${entry}'. Expected: server-name=token`);
    }
    const serverName = entry.slice(0, eqIdx).trim();
    const token = entry.slice(eqIdx + 1).trim();
    if (!serverName) {
      throw new Error(`Invalid --oauth-token '${entry}': server name cannot be empty`);
    }
    if (!token) {
      throw new Error(`Invalid --oauth-token '${entry}': token value cannot be empty`);
    }
    oauthTokens[serverName] = token;
  }

  // Detect OAuth servers missing a token and fail early with a helpful message
  const effectiveServerIds = new Set(expanded.scenarios.flatMap((scenario) => scenario.servers));
  const oauthServers = Array.from(effectiveServerIds).filter((name) => {
    const cfg = expanded.servers?.[name];
    return cfg?.auth?.type === 'oauth_authorization_code';
  });
  const missingTokenServers = oauthServers.filter((name) => !oauthTokens[name]);
  if (missingTokenServers.length > 0) {
    for (const name of missingTokenServers) {
      console.error(
        kleur.red(`OAuth login required for server '${name}'.`) +
          kleur.yellow(` Provide via --oauth-token ${name}=<token>.`)
      );
    }
    const serveUrl = `http://localhost:8787`;
    if (options.openBrowser || process.env['MCPLAB_OPEN_BROWSER'] === '1') {
      console.log(kleur.cyan(`Opening browser to authenticate: ${serveUrl}`));
      openBrowserUrl(serveUrl);
    } else {
      console.log(
        kleur.yellow(
          `Hint: Run 'mcplab serve --open' to authenticate via the UI, or use --open-browser to open the browser automatically.`
        )
      );
    }
    throw new Error(
      `OAuth login required for server(s): ${missingTokenServers.join(
        ', '
      )}. Provide tokens via --oauth-token.`
    );
  }

  const { runDir, results } = await runAll(expanded, {
    runsPerScenario,
    scenarioId: options.scenario,
    runNote,
    configHash: effectiveConfigHash,
    gitCommit: getGitCommit(),
    cliVersion: pkgVersion,
    runsDir: String(options.runsDir),
    oauthTokens: Object.keys(oauthTokens).length > 0 ? oauthTokens : undefined,
    onProgress: async (event) => {
      const line = formatRunProgressEvent(event);
      if (line) {
        console.log(`[${formatNowTime()}] ${line}`);
      }
    }
  });
  const reportPath = join(runDir, 'report.html');
  const resultsPath = join(runDir, 'results.json');
  const summaryPath = join(runDir, 'summary.md');
  writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  writeFileSync(reportPath, renderReport(results), 'utf8');
  writeFileSync(summaryPath, renderSummaryMarkdown(results), 'utf8');
  console.log(kleur.green(`✅ Run complete. Results: ${runDir}`));

  const failedRuns = results.scenarios.reduce(
    (sum, scenario) => sum + scenario.runs.filter((run) => !run.pass).length,
    0
  );

  return {
    runDir,
    runId: results.metadata.run_id,
    passed: failedRuns === 0,
    shouldFailOnDrift: false
  };
}

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
      return `Connecting MCP servers (${event.serverCount}): ${event.serverNames.join(', ')}...`;
    case 'mcp_connect_finished':
      return `Connected MCP servers (${event.serverCount}): ${event.serverNames.join(', ')}.`;
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

function pruneFailedRunsOnStartIfEnabled(actionCommand: Command): void {
  if (!actionCommand.options.some((option) => option.attributeName() === 'runsDir')) {
    return;
  }
  const opts = actionCommand.optsWithGlobals<{ pruneFailedRunsOnStart?: boolean }>();

  const envToggle = process.env.MCPLAB_PRUNE_FAILED_RUNS_ON_START?.trim().toLowerCase();
  const enabled =
    envToggle === '0' || envToggle === 'false' || envToggle === 'no' || envToggle === 'off'
      ? false
      : opts.pruneFailedRunsOnStart !== false;
  if (!enabled) return;

  const runsDir = resolveRunArtifactsDir(actionCommand);
  if (!existsSync(runsDir)) return;

  const runDirs = readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dirPath = join(runsDir, entry.name);
      return { path: dirPath };
    });

  let deletedAbandonedRuns = 0;
  for (const entry of runDirs) {
    if (!isAbandonedRun(join(entry.path, 'results.json'))) continue;
    rmSync(entry.path, { recursive: true, force: true });
    deletedAbandonedRuns += 1;
  }

  if (runDirs.length > 0) {
    console.log(
      kleur.gray(
        `[mcplab-app] Startup cleanup: checked ${runDirs.length} run folder(s); removed ${deletedAbandonedRuns} incomplete run folder(s).`
      )
    );
  }
}

function resolveRunArtifactsDir(actionCommand: Command): string {
  const merged = actionCommand.optsWithGlobals<{ runsDir?: string }>();
  const raw = merged.runsDir?.trim();
  return resolve(raw && raw.length > 0 ? raw : 'mcplab/results/evaluation-runs');
}

function isAbandonedRun(resultsPath: string): boolean {
  return !existsSync(resultsPath);
}
