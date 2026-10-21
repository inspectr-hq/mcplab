import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyEvaluationSettingsPatch,
  applySettingsOverrides,
  persistSettingsOverrides
} from './settings-store.js';
import { loadWorkspaceSettingsOverrides } from '@inspectr/mcplab-core';
import type { AppSettings } from './types.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Decision Engine settings', () => {
  it('persists, reloads, and clears the workspace default evaluation agent', () => {
    const settings = fixture();
    const next = applyEvaluationSettingsPatch(
      settings,
      { defaultEvaluationAgentName: ' judge ' },
      agents
    );
    persistSettingsOverrides(next);
    applySettingsOverrides(settings);
    expect(settings.defaultEvaluationAgentName).toBe('judge');
    expect(
      loadWorkspaceSettingsOverrides(settings.librariesDir).default_evaluation_agent_name
    ).toBe('judge');
    persistSettingsOverrides(
      applyEvaluationSettingsPatch(settings, { defaultEvaluationAgentName: null }, agents)
    );
    applySettingsOverrides(settings);
    expect(settings.defaultEvaluationAgentName).toBeUndefined();
  });
  it('rejects deleted and browser workspace defaults atomically', () => {
    const settings = fixture();
    expect(() =>
      applyEvaluationSettingsPatch(settings, { defaultEvaluationAgentName: 'deleted' }, agents)
    ).toThrow('Default evaluation agent not found');
    expect(settings.defaultEvaluationAgentName).toBeUndefined();
    expect(() =>
      applyEvaluationSettingsPatch(settings, { defaultEvaluationAgentName: 'browser' }, agents)
    ).toThrow('Default evaluation agent must be an LLM agent');
  });
  it('reads the library once for a combined agent settings patch', () => {
    const readAgents = vi.fn(() => agents);
    applyEvaluationSettingsPatch(
      fixture(),
      { defaultEvaluationAgentName: 'judge', evaluationJudgeAgentName: 'judge' },
      readAgents
    );
    expect(readAgents).toHaveBeenCalledTimes(1);
  });
  it.each(['deleted', undefined])(
    'does not revalidate %s judge when saving unrelated settings',
    (name) => {
      const settings = {
        ...fixture(),
        evaluationJudgeAgentName: name,
        evaluationDecision: decision
      };
      const readAgents = () => {
        throw new Error('Agent library must not be read');
      };
      expect(
        applyEvaluationSettingsPatch(settings, { defaultQueueWorkers: 4 }, readAgents)
          .evaluationDecision
      ).toEqual(decision);
    }
  );
  it('allows clearing the engine when its backup judge has been deleted', () => {
    const settings = {
      ...fixture(),
      evaluationJudgeAgentName: 'deleted',
      evaluationDecision: decision
    };
    expect(
      applyEvaluationSettingsPatch(settings, { evaluationDecision: null }, {}).evaluationDecision
    ).toBeUndefined();
  });
  it('stores a disabled engine without revalidating a missing judge, and preserves it on reload', () => {
    const settings = {
      ...fixture(),
      evaluationJudgeAgentName: 'deleted',
      evaluationDecision: decision
    };
    const disabled = { ...decision, enabled: false };
    const next = applyEvaluationSettingsPatch(settings, { evaluationDecision: disabled }, () => {
      throw new Error('Must not read the judge');
    });
    persistSettingsOverrides(next);
    applySettingsOverrides(settings);
    expect(settings.evaluationDecision).toEqual(disabled);
    expect(loadWorkspaceSettingsOverrides(settings.librariesDir).evaluation_decision).toEqual(
      disabled
    );
    expect(() =>
      applyEvaluationSettingsPatch(
        next,
        { evaluationDecision: { ...disabled, enabled: true } },
        agents
      )
    ).toThrow('not found');
  });
  it('allows removing a judge while retaining a disabled engine, but requires backup to enable it', () => {
    const disabled = { ...decision, enabled: false };
    const settings = {
      ...fixture(),
      evaluationJudgeAgentName: 'judge',
      evaluationDecision: disabled
    };
    const next = applyEvaluationSettingsPatch(settings, { evaluationJudgeAgentName: null }, agents);
    expect(next.evaluationDecision).toEqual(disabled);
    expect(next.evaluationJudgeAgentName).toBeUndefined();
    expect(() =>
      applyEvaluationSettingsPatch(next, { evaluationDecision: decision }, agents)
    ).toThrow('backup');
  });
  it('allows switching to a workspace with a saved engine and no matching judge', () => {
    const settings = fixture();
    const newWorkspace = fixture();
    persistSettingsOverrides({
      ...newWorkspace,
      evaluationDecision: decision,
      evaluationJudgeAgentName: 'deleted'
    });
    const candidate = { ...settings, librariesDir: newWorkspace.librariesDir };
    applySettingsOverrides(candidate);
    const readAgents = () => {
      throw new Error('Agent library must not be read');
    };
    expect(
      applyEvaluationSettingsPatch(
        candidate,
        { librariesDir: newWorkspace.librariesDir },
        readAgents
      )
    ).toMatchObject({ librariesDir: newWorkspace.librariesDir, evaluationDecision: decision });
  });
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

  it('persists a Foundry deployment without persisting backend credentials', () => {
    const settings = fixture();
    const foundry = {
      provider: 'azure_foundry' as const,
      model: 'my-decision-deployment',
      enabled: true,
      passThreshold: 0.9,
      failThreshold: 0.1
    };
    const next = applyEvaluationSettingsPatch(
      settings,
      {
        evaluationJudgeAgentName: 'judge',
        evaluationDecision: {
          ...foundry,
          apiKey: 'must-not-persist',
          endpoint: 'https://must-not-persist.example'
        }
      },
      agents
    );
    persistSettingsOverrides(next);
    applySettingsOverrides(settings);
    expect(settings.evaluationDecision).toEqual(foundry);
    expect(loadWorkspaceSettingsOverrides(settings.librariesDir).evaluation_decision).toEqual(
      foundry
    );
    const yaml = readFileSync(join(settings.librariesDir, '.mcplab-app-settings.yaml'), 'utf8');
    expect(yaml).not.toContain('must-not-persist');
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

  it('reads the assistant agent saved under its old key and saves it under the new one', () => {
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
    const file = join(settings.librariesDir, '.mcplab-app-settings.yaml');
    writeFileSync(file, 'scenario_assistant_agent_name: legacy-agent\n', 'utf8');

    applySettingsOverrides(settings);
    expect(settings.assistantAgentName).toBe('legacy-agent');

    persistSettingsOverrides(settings);
    const saved = readFileSync(file, 'utf8');
    expect(saved).toContain('assistant_agent_name: legacy-agent');
    expect(saved).not.toContain('scenario_assistant_agent_name');
  });

  it('prefers the new assistant agent key when both are present', () => {
    const root = mkdtempSync(join(tmpdir(), 'mcplab-settings-'));
    roots.push(root);
    writeFileSync(
      join(root, '.mcplab-app-settings.yaml'),
      'scenario_assistant_agent_name: old\nassistant_agent_name: new\n',
      'utf8'
    );
    expect(loadWorkspaceSettingsOverrides(root).assistant_agent_name).toBe('new');
  });
});
