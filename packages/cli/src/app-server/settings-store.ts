import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import {
  loadWorkspaceSettingsOverrides,
  normalizeEvaluationDecisionConfig,
  resolveEvaluationJudge,
  type EvalConfig,
  type WorkspaceSettingsOverrides
} from '@inspectr/mcplab-core';
import type { AppSettings } from './types.js';
export { loadWorkspaceSettingsOverrides } from '@inspectr/mcplab-core';

const DEFAULT_QUEUE_WORKERS = 1;
const MAX_QUEUE_WORKERS = 8;

function clampQueueWorkerCount(value: number): number {
  const normalized = Math.floor(value);
  if (normalized < 1) return 1;
  if (normalized > MAX_QUEUE_WORKERS) return MAX_QUEUE_WORKERS;
  return normalized;
}

export function normalizeQueueWorkerCount(value: unknown): number {
  if (typeof value === 'string' && value.trim().length === 0) {
    return DEFAULT_QUEUE_WORKERS;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_QUEUE_WORKERS;
  return clampQueueWorkerCount(parsed);
}

function resolveEnvQueueWorkers(): number | undefined {
  const raw = process.env['MCPLAB_QUEUE_WORKERS'];
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return clampQueueWorkerCount(parsed);
}

function settingsOverridesFilePath(settings: AppSettings): string {
  return join(settings.librariesDir, '.mcplab-app-settings.yaml');
}

export function applySettingsOverrides(settings: AppSettings): void {
  const overrides = loadWorkspaceSettingsOverrides(settings.librariesDir);
  settings.defaultQueueWorkers = normalizeQueueWorkerCount(overrides.default_queue_workers);
  const envQueueWorkers = resolveEnvQueueWorkers();
  if (envQueueWorkers !== undefined) settings.defaultQueueWorkers = envQueueWorkers;
  settings.scenarioAssistantAgentName =
    overrides.scenario_assistant_agent_name?.trim() || undefined;
  settings.evaluationJudgeAgentName = overrides.evaluation_judge_agent_name?.trim() || undefined;
  settings.evaluationDecision = overrides.evaluation_decision;
}

/** Validate the combined evaluation patch before changing settings or writing files. */
export function applyEvaluationSettingsPatch(
  settings: AppSettings,
  body: Record<string, unknown>,
  agents: EvalConfig['agents']
): AppSettings {
  const candidate = { ...settings };
  const hasJudge = Object.prototype.hasOwnProperty.call(body, 'evaluationJudgeAgentName');
  const hasDecision = Object.prototype.hasOwnProperty.call(body, 'evaluationDecision');
  if (hasJudge) {
    candidate.evaluationJudgeAgentName =
      String(body.evaluationJudgeAgentName ?? '').trim() || undefined;
  }
  if (hasDecision) {
    candidate.evaluationDecision =
      body.evaluationDecision === null
        ? undefined
        : normalizeEvaluationDecisionConfig(body.evaluationDecision);
  }
  if (hasJudge || candidate.evaluationDecision) {
    const judge = resolveEvaluationJudge({
      agents,
      evaluationJudgeAgentName: candidate.evaluationJudgeAgentName
    });
    if (candidate.evaluationDecision && !judge) {
      throw new Error('Decision engines require a configured LLM evaluation judge as backup.');
    }
  }
  return candidate;
}

export function persistSettingsOverrides(settings: AppSettings): void {
  const payload: WorkspaceSettingsOverrides = {
    default_queue_workers: normalizeQueueWorkerCount(settings.defaultQueueWorkers),
    ...(settings.scenarioAssistantAgentName
      ? { scenario_assistant_agent_name: settings.scenarioAssistantAgentName }
      : {}),
    ...(settings.evaluationJudgeAgentName
      ? { evaluation_judge_agent_name: settings.evaluationJudgeAgentName }
      : {}),
    ...(settings.evaluationDecision ? { evaluation_decision: settings.evaluationDecision } : {})
  };
  writeFileSync(settingsOverridesFilePath(settings), `${stringifyYaml(payload)}\n`, 'utf8');
}
