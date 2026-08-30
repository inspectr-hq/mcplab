import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEvaluationConfigFile } from './evaluation-config-store.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('createEvaluationConfigFile', () => {
  it('normalizes names and creates unique YAML files', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-eval-store-')); roots.push(root);
    const first = createEvaluationConfigFile({ evalsDir: join(root, 'evals'), fileName: 'DeepSeek Library Eval', config: { name: 'DeepSeek Library Eval', agents: [], scenarios: [] } });
    const second = createEvaluationConfigFile({ evalsDir: join(root, 'evals'), fileName: 'DeepSeek Library Eval', config: { name: 'DeepSeek Library Eval', agents: [], scenarios: [] } });
    expect(first.fileName).toBe('deepseek-library-eval');
    expect(second.fileName).toBe('deepseek-library-eval-1');
    expect(existsSync(first.path)).toBe(true);
    expect(existsSync(second.path)).toBe(true);
  });
});
