import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyEvaluationSettingsPatch,
  applySettingsOverrides,
  loadWorkspaceSettingsOverrides,
  persistSettingsOverrides
} from './settings-store.js';
import type { AppSettings } from './types.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Decision Engine settings', () => {
  const decision = {
    provider: 'ollama' as const,
    model: 'clef-flash',
    passThreshold: 0.9,
    failThreshold: 0.1,
    baseUrl: 'http://localhost:11434'
  };
  const agents = {
    judge: { provider: 'openai' as const, model: 'gpt-5-mini' },
    browser: { type: 'browser' as const, provider: 'polo', url: 'https://polo.example' }
  };
  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-decision-settings-'));
    roots.push(root);
    const settings: AppSettings = {
      workspaceRoot: root,
      evalsDir: join(root, 'evals'),
      runsDir: join(root, 'runs'),
      toolAnalysisResultsDir: join(root, 'analysis'),
      librariesDir: join(root, 'libs'),
      defaultQueueWorkers: 1
    };
    mkdirSync(settings.librariesDir, { recursive: true });
    return settings;
  };

  it('persists and reloads the decision configuration without agent library changes', () => {
    const settings = fixture();
    const next = applyEvaluationSettingsPatch(
      settings,
      { evaluationJudgeAgentName: 'judge', evaluationDecision: decision },
      agents
    );
    persistSettingsOverrides(next);
    applySettingsOverrides(settings);
    expect(settings.evaluationJudgeAgentName).toBe('judge');
    expect(settings.evaluationDecision).toEqual(decision);
    expect(loadWorkspaceSettingsOverrides(settings.librariesDir).evaluation_decision).toEqual(
      decision
    );
  });

  it('clears decision settings with null and leaves historical settings judge-only', () => {
    const settings = {
      ...fixture(),
      evaluationJudgeAgentName: 'judge',
      evaluationDecision: decision
    };
    persistSettingsOverrides(settings);
    const next = applyEvaluationSettingsPatch(
      settings,
      { evaluationDecision: null, evaluationJudgeAgentName: null },
      agents
    );
    persistSettingsOverrides(next);
    applySettingsOverrides(settings);
    expect(settings.evaluationDecision).toBeUndefined();
    expect(settings.evaluationJudgeAgentName).toBeUndefined();
    expect(
      readFileSync(join(settings.librariesDir, '.mcplab-app-settings.yaml'), 'utf8')
    ).not.toContain('evaluation_decision');
  });

  it.each([
    { passThreshold: 0.1, failThreshold: 0.9 },
    { passThreshold: 0.5, failThreshold: 0.5 },
    { passThreshold: Infinity, failThreshold: 0.1 },
    { passThreshold: 0.9, failThreshold: -0.1 }
  ])('rejects invalid thresholds without changing current settings: %j', (thresholds) => {
    const settings = fixture();
    const original = { ...settings };
    expect(() =>
      applyEvaluationSettingsPatch(
        settings,
        { evaluationJudgeAgentName: 'judge', evaluationDecision: { ...decision, ...thresholds } },
        agents
      )
    ).toThrow();
    expect(settings).toEqual(original);
  });

  it('requires an LLM judge when enabling and rejects clearing an existing backup atomically', () => {
    const settings = fixture();
    expect(() =>
      applyEvaluationSettingsPatch(settings, { evaluationDecision: decision }, agents)
    ).toThrow('backup');
    expect(() =>
      applyEvaluationSettingsPatch(
        settings,
        { evaluationDecision: decision, evaluationJudgeAgentName: 'browser' },
        agents
      )
    ).toThrow('LLM');
    const enabled = applyEvaluationSettingsPatch(
      settings,
      { evaluationJudgeAgentName: 'judge', evaluationDecision: decision },
      agents
    );
    expect(() =>
      applyEvaluationSettingsPatch(enabled, { evaluationJudgeAgentName: null }, agents)
    ).toThrow('backup');
    expect(enabled.evaluationJudgeAgentName).toBe('judge');
    expect(enabled.evaluationDecision).toEqual(decision);
  });

  it('preserves malformed persisted decision configuration for runtime judge fallback', () => {
    const settings = fixture();
    writeFileSync(
      join(settings.librariesDir, '.mcplab-app-settings.yaml'),
      'evaluation_judge_agent_name: judge\nevaluation_decision:\n  provider: unknown\n'
    );
    applySettingsOverrides(settings);
    expect(settings.evaluationDecision).toEqual({ provider: 'unknown' });
    expect(settings.evaluationJudgeAgentName).toBe('judge');
  });

  it('tolerates invalid YAML and non-string persisted agent names', () => {
    const settings = fixture();
    const path = join(settings.librariesDir, '.mcplab-app-settings.yaml');
    writeFileSync(path, 'evaluation_judge_agent_name: 12\nscenario_assistant_agent_name: []\n');
    expect(() => applySettingsOverrides(settings)).not.toThrow();
    expect(settings.evaluationJudgeAgentName).toBeUndefined();
    writeFileSync(path, '[broken');
    expect(loadWorkspaceSettingsOverrides(settings.librariesDir)).toEqual({});
  });
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
});
