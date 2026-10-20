import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { normalizeSourceConfig } from './config.js';
import type { SourceEvalConfig } from './types.js';

export type CreatedEvaluationConfigFile = {
  fileName: string;
  path: string;
  relativePath: string;
  config: SourceEvalConfig;
  warnings: string[];
};
export type UpdatedEvaluationConfigFile = CreatedEvaluationConfigFile;

export function safeEvaluationConfigFileName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `config-${Date.now()}`
  );
}

export function createEvaluationConfigFile(params: {
  evalsDir: string;
  fileName: string;
  folder?: string;
  config: SourceEvalConfig;
}): CreatedEvaluationConfigFile {
  const evalsDir = resolve(params.evalsDir);
  const fileName = safeEvaluationConfigFileName(params.fileName);
  const { config, warnings } = normalizeSourceConfig(params.config);
  const folder = params.folder?.trim();
  if (
    folder &&
    (isAbsolute(folder) ||
      folder.startsWith('/') ||
      folder.startsWith('\\') ||
      /^[a-z]:/i.test(folder) ||
      folder.split(/[\\/]+/).includes('..'))
  ) {
    throw new Error('Evaluation config folder must be a relative path inside the evals directory.');
  }
  const targetDir = folder ? resolve(evalsDir, folder) : evalsDir;
  if (targetDir !== evalsDir && !targetDir.startsWith(`${evalsDir}${sep}`))
    throw new Error('Evaluation config folder is outside the configured evals directory.');
  mkdirSync(targetDir, { recursive: true });
  const realEvalsDir = realpathSync(evalsDir);
  const realTargetDir = realpathSync(targetDir);
  if (realTargetDir !== realEvalsDir && !realTargetDir.startsWith(`${realEvalsDir}${sep}`))
    throw new Error('Evaluation config folder is outside the configured evals directory.');
  let target = join(targetDir, `${fileName}.yaml`);
  let suffix = 1;
  while (existsSync(target)) target = join(targetDir, `${fileName}-${suffix++}.yaml`);
  const resolvedTarget = resolve(target);
  if (!resolvedTarget.startsWith(`${evalsDir}${sep}`))
    throw new Error('Evaluation config path is outside the configured evals directory.');
  try {
    writeFileSync(resolvedTarget, `${stringifyYaml(config)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Evaluation config '${fileName}' already exists.`);
    }
    throw error;
  }
  return {
    fileName: resolvedTarget.slice(evalsDir.length + 1).replace(/\.yaml$/i, ''),
    path: resolvedTarget,
    relativePath: relative(evalsDir, resolvedTarget).split(sep).join('/'),
    config,
    warnings
  };
}

export function updateEvaluationConfigFile(params: {
  evalsDir: string;
  filePath: string;
  config: SourceEvalConfig;
}): UpdatedEvaluationConfigFile {
  const evalsDir = resolve(params.evalsDir);
  const path = resolve(evalsDir, params.filePath);
  if (!path.startsWith(`${evalsDir}${sep}`) || !/\.ya?ml$/i.test(path))
    throw new Error('Evaluation config path is outside the configured evals directory.');
  if (!existsSync(path)) throw new Error(`Evaluation config not found: ${params.filePath}`);
  const { config, warnings } = normalizeSourceConfig(params.config);
  writeFileSync(path, `${stringifyYaml(config)}\n`, { encoding: 'utf8' });
  return {
    fileName: path.slice(evalsDir.length + 1).replace(/\.ya?ml$/i, ''),
    path,
    relativePath: relative(evalsDir, path).split(sep).join('/'),
    config,
    warnings
  };
}

export function readEvaluationConfigFile(params: { evalsDir: string; filePath: string }): {
  fileName: string;
  path: string;
  relativePath: string;
  config: SourceEvalConfig;
} {
  const evalsDir = resolve(params.evalsDir);
  const path = resolve(evalsDir, params.filePath);
  if (!path.startsWith(`${evalsDir}${sep}`) || !/\.ya?ml$/i.test(path))
    throw new Error('Evaluation config path is outside the configured evals directory.');
  if (!existsSync(path)) throw new Error(`Evaluation config not found: ${params.filePath}`);
  const parsed = normalizeSourceConfig(
    (parseYaml(readFileSync(path, 'utf8')) ?? {}) as SourceEvalConfig
  );
  return {
    fileName: path.slice(evalsDir.length + 1).replace(/\.ya?ml$/i, ''),
    path,
    relativePath: relative(evalsDir, path).split(sep).join('/'),
    config: parsed.config
  };
}
