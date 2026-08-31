import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { normalizeSourceConfig } from './config.js';
import type { SourceEvalConfig } from './types.js';

export type CreatedEvaluationConfigFile = {
  fileName: string;
  path: string;
  relativePath: string;
  config: SourceEvalConfig;
  warnings: string[];
};

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
  config: SourceEvalConfig;
}): CreatedEvaluationConfigFile {
  const evalsDir = resolve(params.evalsDir);
  const fileName = safeEvaluationConfigFileName(params.fileName);
  const { config, warnings } = normalizeSourceConfig(params.config);
  mkdirSync(evalsDir, { recursive: true });
  let target = join(evalsDir, `${fileName}.yaml`);
  let suffix = 1;
  while (existsSync(target)) target = join(evalsDir, `${fileName}-${suffix++}.yaml`);
  const resolvedTarget = resolve(target);
  if (!resolvedTarget.startsWith(`${evalsDir}${sep}`))
    throw new Error('Evaluation config path is outside the configured evals directory.');
  writeFileSync(resolvedTarget, `${stringifyYaml(config)}\n`, 'utf8');
  return {
    fileName: resolvedTarget.slice(evalsDir.length + 1).replace(/\.yaml$/i, ''),
    path: resolvedTarget,
    relativePath: relative(evalsDir, resolvedTarget).split(sep).join('/'),
    config,
    warnings
  };
}
