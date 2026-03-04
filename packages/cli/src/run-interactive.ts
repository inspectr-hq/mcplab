import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import kleur from 'kleur';
import type { EvalConfig } from '@inspectr/mcplab-core';
import { parse } from 'yaml';

export const INTERACTIVE_ABORT_ERROR = 'Interactive input cancelled.';

export type InteractiveAgentMode = 'all' | 'defaults' | 'specific';

export interface InteractiveSelectionResult {
  configPath: string;
  agentMode: InteractiveAgentMode;
  agents?: string[];
}

export interface ResolveRunOptionsInput {
  interactive: boolean;
  config?: string;
  agents?: string;
  agentsAll?: boolean;
  interactiveSelection?: InteractiveSelectionResult;
}

export interface ResolveRunOptionsResult {
  config: string;
  agents?: string;
  agentsAll: boolean;
}

export interface RunInteractiveSelectionOptions {
  initialConfigPath?: string;
  defaultEvalsDir?: string;
  cwd?: string;
  promptAgentSelection?: boolean;
  loadConfigForValidation: (path: string) => { config: EvalConfig };
}

export function parseNumberSelection(input: string, max: number): number[] {
  const parts = input
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Please provide at least one number.');
  }

  const indices: number[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new Error(`Invalid selection "${part}". Expected numeric values.`);
    }
    const oneBased = Number(part);
    if (!Number.isInteger(oneBased) || oneBased < 1 || oneBased > max) {
      throw new Error(`Selection "${part}" is out of range (1-${max}).`);
    }
    const zeroBased = oneBased - 1;
    if (!seen.has(zeroBased)) {
      seen.add(zeroBased);
      indices.push(zeroBased);
    }
  }
  return indices;
}

export function resolveRunOptions(input: ResolveRunOptionsInput): ResolveRunOptionsResult {
  const agentsCsv = input.agents?.trim();
  const agentsAll = Boolean(input.agentsAll);

  if (agentsAll && agentsCsv) {
    throw new Error('Use either --agents or --agents-all, not both.');
  }

  if (!input.interactive) {
    if (!input.config?.trim()) {
      throw new Error('config is required');
    }
    return {
      config: input.config.trim(),
      agents: agentsCsv || undefined,
      agentsAll
    };
  }

  const selection = input.interactiveSelection;
  const resolvedConfig = input.config?.trim() || selection?.configPath;
  if (!resolvedConfig) {
    throw new Error('config is required');
  }

  if (agentsAll || agentsCsv) {
    return {
      config: resolvedConfig,
      agents: agentsCsv || undefined,
      agentsAll
    };
  }

  if (!selection) {
    return {
      config: resolvedConfig,
      agentsAll: false
    };
  }

  if (selection.agentMode === 'all') {
    return {
      config: resolvedConfig,
      agentsAll: true
    };
  }

  if (selection.agentMode === 'specific') {
    if (!selection.agents || selection.agents.length === 0) {
      throw new Error('Interactive specific agent selection cannot be empty.');
    }
    return {
      config: resolvedConfig,
      agents: selection.agents.join(','),
      agentsAll: false
    };
  }

  return {
    config: resolvedConfig,
    agentsAll: false
  };
}

export async function runInteractiveSelection(
  opts: RunInteractiveSelectionOptions
): Promise<InteractiveSelectionResult> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('--interactive requires a TTY terminal.');
  }

  const cwd = opts.cwd ?? process.cwd();
  const evalsDir = resolve(cwd, opts.defaultEvalsDir ?? 'mcplab/evals');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
    rl.close();
  };
  process.once('SIGINT', onSigint);

  const ask = async (question: string): Promise<string> => {
    try {
      return await rl.question(question);
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
  };

  try {
    const configPath = opts.initialConfigPath
      ? resolve(cwd, opts.initialConfigPath)
      : await promptForConfigPath(ask, evalsDir, cwd, opts.loadConfigForValidation);

    const shouldPromptAgentSelection = opts.promptAgentSelection ?? true;
    if (!shouldPromptAgentSelection) {
      return { configPath, agentMode: 'defaults' };
    }

    const loaded = opts.loadConfigForValidation(configPath);
    const agentIds = Object.keys(loaded.config.agents);
    const defaults = loaded.config.run_defaults?.selected_agents ?? [];
    const agentMode = await promptForAgentMode(ask, agentIds, defaults);

    if (agentMode === 'specific') {
      const agents = await promptForSpecificAgents(ask, agentIds);
      return { configPath, agentMode, agents };
    }

    return { configPath, agentMode };
  } finally {
    process.off('SIGINT', onSigint);
    rl.close();
  }
}

async function promptForConfigPath(
  ask: (question: string) => Promise<string>,
  evalsDir: string,
  cwd: string,
  loadConfigForValidation: (path: string) => { config: EvalConfig }
): Promise<string> {
  const files = existsSync(evalsDir)
    ? readdirSync(evalsDir)
        .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
        .sort((a, b) => a.localeCompare(b))
    : [];
  const choices = files.map((fileName) => {
    const path = resolve(evalsDir, fileName);
    return {
      path,
      fileName,
      label: readConfigName(path) ?? fileName
    };
  });

  if (choices.length > 0) {
    console.log(kleur.cyan('\nSelect an evaluation config:'));
    choices.forEach((choice, index) => {
      const suffix =
        choice.label === choice.fileName ? '' : ` ${kleur.gray(`(${choice.fileName})`)}`;
      console.log(`${index + 1}. ${choice.label}${suffix}`);
    });
  } else {
    console.log(kleur.yellow(`\nNo configs found in ${evalsDir}. Enter a path manually.`));
  }

  while (true) {
    const prompt = choices.length > 0 ? 'Config number or path: ' : 'Config path: ';
    const input = (await ask(prompt)).trim();
    if (!input) {
      console.log(kleur.yellow('Please enter a selection.'));
      continue;
    }

    let candidatePath = input;
    if (choices.length > 0 && /^\d+$/.test(input)) {
      const selected = Number(input);
      if (selected < 1 || selected > choices.length) {
        console.log(kleur.yellow(`Selection out of range (1-${choices.length}).`));
        continue;
      }
      candidatePath = choices[selected - 1]!.path;
    } else {
      candidatePath = resolve(cwd, input);
    }

    try {
      loadConfigForValidation(candidatePath);
      return candidatePath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(kleur.yellow(`Invalid config: ${message}`));
    }
  }
}

function readConfigName(configPath: string): string | undefined {
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = parse(raw) as { name?: unknown } | null;
    const name = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
    return name || undefined;
  } catch {
    return undefined;
  }
}

async function promptForAgentMode(
  ask: (question: string) => Promise<string>,
  agentIds: string[],
  defaults: string[]
): Promise<InteractiveAgentMode> {
  if (agentIds.length === 0) {
    throw new Error('Config has no resolved agents.');
  }

  console.log(kleur.cyan('\nSelect agent mode:'));
  console.log('1. All configured agents');
  if (defaults.length > 0) {
    console.log(`2. Run defaults from config (${defaults.join(', ')})`);
  }
  console.log(defaults.length > 0 ? '3. Choose specific agents' : '2. Choose specific agents');

  const max = defaults.length > 0 ? 3 : 2;
  while (true) {
    const input = (await ask('Choice: ')).trim();
    try {
      const selections = parseNumberSelection(input, max);
      if (selections.length !== 1) {
        throw new Error('Choose exactly one option.');
      }
      const selected = selections[0] as number;
      if (selected === 0) return 'all';
      if (defaults.length > 0 && selected === 1) return 'defaults';
      return 'specific';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(kleur.yellow(message));
    }
  }
}

async function promptForSpecificAgents(
  ask: (question: string) => Promise<string>,
  agentIds: string[]
): Promise<string[]> {
  console.log(kleur.cyan('\nSelect specific agents (comma-separated numbers):'));
  agentIds.forEach((agentId, index) => {
    console.log(`${index + 1}. ${agentId}`);
  });

  while (true) {
    const input = (await ask('Agent numbers: ')).trim();
    try {
      const selectedIndices = parseNumberSelection(input, agentIds.length);
      if (selectedIndices.length === 0) {
        throw new Error('Select at least one agent.');
      }
      return selectedIndices.map((index) => agentIds[index] as string);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(kleur.yellow(message));
    }
  }
}
