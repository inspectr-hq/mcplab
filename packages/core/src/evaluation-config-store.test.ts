import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEvaluationConfigFile,
  readEvaluationConfigFile,
  updateEvaluationConfigFile
} from './evaluation-config-store.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('createEvaluationConfigFile', () => {
  it('normalizes names and creates unique YAML files', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-eval-store-'));
    roots.push(root);
    const first = createEvaluationConfigFile({
      evalsDir: join(root, 'evals'),
      fileName: 'DeepSeek Library Eval',
      config: { name: 'DeepSeek Library Eval', agents: [], scenarios: [] }
    });
    const second = createEvaluationConfigFile({
      evalsDir: join(root, 'evals'),
      fileName: 'DeepSeek Library Eval',
      config: { name: 'DeepSeek Library Eval', agents: [], scenarios: [] }
    });
    expect(first.fileName).toBe('deepseek-library-eval');
    expect(second.fileName).toBe('deepseek-library-eval-1');
    expect(existsSync(first.path)).toBe(true);
    expect(existsSync(second.path)).toBe(true);
  });

  it('reads and updates an existing config without creating a new file', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-eval-store-'));
    roots.push(root);
    const created = createEvaluationConfigFile({
      evalsDir: join(root, 'evals'),
      fileName: 'suite',
      config: { name: 'Before', agents: [], scenarios: [] }
    });

    expect(readEvaluationConfigFile({ evalsDir: join(root, 'evals'), filePath: 'suite.yaml' }).config.name).toBe('Before');
    const updated = updateEvaluationConfigFile({
      evalsDir: join(root, 'evals'),
      filePath: 'suite.yaml',
      config: { name: 'After', agents: [], scenarios: [] }
    });
    expect(updated.config.name).toBe('After');
    expect(readFileSync(created.path, 'utf8')).toContain('After');
    expect(existsSync(join(root, 'evals', 'suite-1.yaml'))).toBe(false);
  });
});
