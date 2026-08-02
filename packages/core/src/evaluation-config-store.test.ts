import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEvaluationConfigFile } from './evaluation-config-store.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('createEvaluationConfigFile', () => {
  it('normalizes config and resolves a unique canonical evaluation filename', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-evaluation-config-store-'));
    temporaryRoots.push(root);
    const evalsDir = join(root, 'evals');

    const first = createEvaluationConfigFile({
      evalsDir,
      fileName: 'DeepSeek Library Eval',
      config: { name: 'DeepSeek Library Eval', agents: [], scenarios: [] }
    });
    const second = createEvaluationConfigFile({
      evalsDir,
      fileName: 'DeepSeek Library Eval',
      config: { name: 'DeepSeek Library Eval', agents: [], scenarios: [] }
    });

    expect(first.fileName).toBe('deepseek-library-eval');
    expect(first.relativePath).toBe('deepseek-library-eval.yaml');
    expect(second.fileName).toBe('deepseek-library-eval-1');
    expect(existsSync(first.path)).toBe(true);
    expect(existsSync(second.path)).toBe(true);
  });
});
