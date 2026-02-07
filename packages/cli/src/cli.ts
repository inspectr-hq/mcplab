#!/usr/bin/env node
import "dotenv/config";
import { Command } from 'commander';
import kleur from 'kleur';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig, selectScenarios, runAll } from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import pkg from '../package.json' with { type: 'json' };
import { execSync } from 'node:child_process';
import chokidar from 'chokidar';

const program = new Command();
program.name('mcplab').description('Laboratory for testing Model Context Protocol servers').version(pkg.version);

program
  .command('run')
  .description('Run evaluation scenarios')
  .requiredOption('-c, --config <path>', 'Path to eval.yaml')
  .option('-s, --scenario <id>', 'Run a single scenario')
  .option('-n, --runs <count>', 'Variance runs', '1')
  .option('--agents <agents>', 'Comma-separated list of agents to test (runs each scenario with each agent)')
  .action(async (options) => {
    try {
      let { config, hash } = loadConfig(resolve(options.config));

      // If --agents is specified, duplicate scenarios for each agent
      if (options.agents) {
        const requestedAgents = options.agents.split(',').map((a: string) => a.trim());
        const missingAgents = requestedAgents.filter((a: string) => !config.agents[a]);

        if (missingAgents.length > 0) {
          throw new Error(`Unknown agents: ${missingAgents.join(', ')}. Available: ${Object.keys(config.agents).join(', ')}`);
        }

        const baseScenarios = config.scenarios;
        const expandedScenarios = [];

        for (const scenario of baseScenarios) {
          for (const agent of requestedAgents) {
            expandedScenarios.push({
              ...scenario,
              id: `${scenario.id}-${agent}`,
              agent: agent
            });
          }
        }

        config = {
          ...config,
          scenarios: expandedScenarios
        };

        console.log(kleur.cyan(`📊 Testing ${baseScenarios.length} scenarios × ${requestedAgents.length} agents = ${expandedScenarios.length} total tests`));
      }

      const selected = selectScenarios(config, options.scenario);
      const runsPerScenario = Number(options.runs);
      if (Number.isNaN(runsPerScenario) || runsPerScenario <= 0) {
        throw new Error('Runs must be a positive number');
      }
      const { runDir, results } = await runAll(selected, {
        runsPerScenario,
        scenarioId: options.scenario,
        configHash: hash,
        gitCommit: getGitCommit(),
        cliVersion: pkg.version
      });
      const reportPath = join(runDir, 'report.html');
      writeFileSync(reportPath, renderReport(results), 'utf8');
      console.log(kleur.green(`Run completed: ${runDir}`));

      // If multi-agent test, show comparison
      if (options.agents) {
        console.log(kleur.cyan(`\n📈 Run comparison script:`));
        console.log(kleur.gray(`   node scripts/compare-llm-results.mjs ${join(runDir, 'results.json')}`));
      }
    } catch (err: any) {
      const message = err?.message ?? String(err);
      const hint = message.includes("fetch failed")
        ? " Hint: verify the MCP server is running, the SSE URL is correct, and any bearer token env var is set."
        : "";
      console.error(kleur.red(`Error: ${message}${hint}`));
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
  .command('watch')
  .description('Watch config file and auto-rerun evaluations on changes')
  .requiredOption('-c, --config <path>', 'Path to eval.yaml')
  .option('-s, --scenario <id>', 'Run a single scenario')
  .option('-n, --runs <count>', 'Variance runs', '1')
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
        const selected = selectScenarios(config, options.scenario);
        const { runDir, results } = await runAll(selected, {
          runsPerScenario,
          scenarioId: options.scenario,
          configHash: hash,
          gitCommit: getGitCommit(),
          cliVersion: pkg.version
        });
        const reportPath = join(runDir, 'report.html');
        writeFileSync(reportPath, renderReport(results), 'utf8');
        console.log(kleur.green(`✅ Run completed: ${runDir}`));
      } catch (err: any) {
        const message = err?.message ?? String(err);
        const hint = message.includes("fetch failed")
          ? " Hint: verify the MCP server is running, the SSE URL is correct, and any bearer token env var is set."
          : "";
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
