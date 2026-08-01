import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applySettingsOverrides } from './settings-store.js';
import type { AppSettings } from './types.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('applySettingsOverrides', () => {
  it('defaults defaultQueueWorkers to 1 when no overrides file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-settings-'));
    roots.push(root);
    const settings = {
      workspaceRoot: root,
      evalsDir: join(root, 'evals'),
      runsDir: join(root, 'runs'),
      toolAnalysisResultsDir: join(root, 'analysis'),
      librariesDir: join(root, 'libs')
    } as AppSettings;
    mkdirSync(settings.librariesDir, { recursive: true });

    applySettingsOverrides(settings);

    expect(settings.defaultQueueWorkers).toBe(1);
  });

  it('loads defaultQueueWorkers from the overrides file and clamps to 8', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-settings-'));
    roots.push(root);
    const settings = {
      workspaceRoot: root,
      evalsDir: join(root, 'evals'),
      runsDir: join(root, 'runs'),
      toolAnalysisResultsDir: join(root, 'analysis'),
      librariesDir: join(root, 'libs')
    } as AppSettings;
    mkdirSync(settings.librariesDir, { recursive: true });
    writeFileSync(
      join(settings.librariesDir, '.mcplab-app-settings.yaml'),
      'default_queue_workers: 99\n',
      'utf8'
    );

    applySettingsOverrides(settings);

    expect(settings.defaultQueueWorkers).toBe(8);
  });

  it('loads evaluation judge agent name from the overrides file', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-settings-'));
    roots.push(root);
    const settings = {
      workspaceRoot: root,
      evalsDir: join(root, 'evals'),
      runsDir: join(root, 'runs'),
      toolAnalysisResultsDir: join(root, 'analysis'),
      librariesDir: join(root, 'libs')
    } as AppSettings;
    mkdirSync(settings.librariesDir, { recursive: true });
    writeFileSync(
      join(settings.librariesDir, '.mcplab-app-settings.yaml'),
      'evaluation_judge_agent_name: judge-1\n',
      'utf8'
    );

    applySettingsOverrides(settings);

    expect(settings.evaluationJudgeAgentName).toBe('judge-1');
  });

  it('loads the global copilot agent name from the overrides file', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-settings-'));
    roots.push(root);
    const settings = {
      workspaceRoot: root,
      evalsDir: join(root, 'evals'),
      runsDir: join(root, 'runs'),
      toolAnalysisResultsDir: join(root, 'analysis'),
      librariesDir: join(root, 'libs')
    } as AppSettings;
    mkdirSync(settings.librariesDir, { recursive: true });
    writeFileSync(
      join(settings.librariesDir, '.mcplab-app-settings.yaml'),
      'global_copilot_agent_name: copilot-1\n',
      'utf8'
    );

    applySettingsOverrides(settings);

    expect(settings.globalCopilotAgentName).toBe('copilot-1');
  });
});
