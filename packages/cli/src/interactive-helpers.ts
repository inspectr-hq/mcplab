import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import kleur from 'kleur';
import { parseNumberSelection, INTERACTIVE_ABORT_ERROR } from './run-interactive.js';

export interface ReportInteractiveSelectionOptions {
  runsDir: string;
  cwd?: string;
}

export interface AppInteractiveOptions {
  host: string;
  port: string;
  evalsDir: string;
  runsDir: string;
  snapshotsDir: string;
  toolAnalysisResultsDir: string;
  librariesDir: string;
}

export function ensureInteractiveTty(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('--interactive requires a TTY terminal.');
  }
}

export async function selectRunDirInteractive(
  options: ReportInteractiveSelectionOptions
): Promise<string> {
  ensureInteractiveTty();
  const cwd = options.cwd ?? process.cwd();
  const runsDir = resolve(cwd, options.runsDir);
  const candidates = getRunDirectoryCandidates(runsDir);

  if (candidates.length === 0) {
    throw new Error(`No run directories with results.json found in ${runsDir}`);
  }

  const ask = createAsker();
  try {
    console.log(kleur.cyan('\nSelect a run directory:'));
    candidates.forEach((candidate, index) => {
      console.log(`${index + 1}. ${candidate.id}`);
    });
    while (true) {
      const input = (await ask.question('Run number or path: ')).trim();
      if (!input) {
        console.log(kleur.yellow('Please enter a selection.'));
        continue;
      }
      if (/^\d+$/.test(input)) {
        const selections = parseNumberSelection(input, candidates.length);
        if (selections.length !== 1) {
          console.log(kleur.yellow('Choose exactly one run.'));
          continue;
        }
        return candidates[selections[0] as number]!.path;
      }
      return resolve(cwd, input);
    }
  } finally {
    ask.close();
  }
}

export async function promptAppOptionsInteractive(
  current: AppInteractiveOptions
): Promise<AppInteractiveOptions> {
  ensureInteractiveTty();
  const ask = createAsker();
  try {
    console.log(kleur.cyan('\nConfigure MCPLab app startup:'));

    const host = await askWithDefault(ask.question, 'Host', current.host);
    const port = await askValidPort(ask.question, current.port);
    const evalsDir = await askWithDefault(ask.question, 'Evals dir', current.evalsDir);
    const runsDir = await askWithDefault(ask.question, 'Runs dir', current.runsDir);
    const snapshotsDir = await askWithDefault(
      ask.question,
      'Snapshots dir',
      current.snapshotsDir
    );
    const toolAnalysisResultsDir = await askWithDefault(
      ask.question,
      'Tool analysis dir',
      current.toolAnalysisResultsDir
    );
    const librariesDir = await askWithDefault(ask.question, 'Libraries dir', current.librariesDir);

    console.log(kleur.cyan('\nApp launch summary:'));
    console.log(`host: ${host}`);
    console.log(`port: ${port}`);
    console.log(`evals-dir: ${evalsDir}`);
    console.log(`runs-dir: ${runsDir}`);
    console.log(`snapshots-dir: ${snapshotsDir}`);
    console.log(`tool-analysis-results-dir: ${toolAnalysisResultsDir}`);
    console.log(`libraries-dir: ${librariesDir}`);

    const confirm = (
      await ask.question('Start app with these settings? [Y/n]: ')
    ).trim().toLowerCase();
    if (confirm === 'n' || confirm === 'no') {
      throw new Error(INTERACTIVE_ABORT_ERROR);
    }

    return {
      host,
      port,
      evalsDir,
      runsDir,
      snapshotsDir,
      toolAnalysisResultsDir,
      librariesDir
    };
  } finally {
    ask.close();
  }
}

function getRunDirectoryCandidates(runsDir: string): Array<{ id: string; path: string }> {
  if (!existsSync(runsDir)) {
    return [];
  }
  return readdirSync(runsDir)
    .map((entry) => ({
      id: entry,
      path: join(runsDir, entry)
    }))
    .filter((entry) => existsSync(join(entry.path, 'results.json')))
    .sort((a, b) => b.id.localeCompare(a.id));
}

async function askWithDefault(
  question: (prompt: string) => Promise<string>,
  label: string,
  defaultValue: string
): Promise<string> {
  const answer = (await question(`${label} [${defaultValue}]: `)).trim();
  return answer || defaultValue;
}

async function askValidPort(
  question: (prompt: string) => Promise<string>,
  defaultPort: string
): Promise<string> {
  while (true) {
    const value = await askWithDefault(question, 'Port', defaultPort);
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return String(parsed);
    }
    console.log(kleur.yellow('Port must be a positive number.'));
  }
}

function createAsker(): { question: (prompt: string) => Promise<string>; close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
    rl.close();
  };
  process.once('SIGINT', onSigint);

  return {
    question: async (prompt: string) => {
      try {
        return await rl.question(prompt);
      } catch (error) {
        if (interrupted) {
          throw new Error(INTERACTIVE_ABORT_ERROR);
        }
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes('closed')) {
          throw new Error(INTERACTIVE_ABORT_ERROR);
        }
        throw error;
      }
    },
    close: () => {
      process.off('SIGINT', onSigint);
      rl.close();
    }
  };
}
