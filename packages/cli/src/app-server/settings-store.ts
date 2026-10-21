import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import {
  isDecisionEngineEnabled,
  loadWorkspaceSettingsOverrides,
  normalizeEvaluationDecisionConfig,
  resolveEvaluationJudge,
  resolveDefaultEvaluationAgent,
  type EvalConfig,
  type WorkspaceSettingsOverrides
} from '@inspectr/mcplab-core';
import type { AppSettings } from './types.js';

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
  settings.assistantAgentName = overrides.assistant_agent_name?.trim() || undefined;
  settings.defaultEvaluationAgentName = overrides.default_evaluation_agent_name;
  settings.evaluationJudgeAgentName = overrides.evaluation_judge_agent_name?.trim() || undefined;
  settings.evaluationDecision = overrides.evaluation_decision;
}

function normalizeAgentName(value: unknown, label: string): string | undefined {
  if (value !== null && value !== undefined && typeof value !== 'string') {
    throw new Error(`${label} must be an agent name or null.`);
  }
  return value?.trim() || undefined;
}

/** Validate the combined evaluation patch before changing settings or writing files. */
export function applyEvaluationSettingsPatch(
  settings: AppSettings,
  body: Record<string, unknown>,
  agents: EvalConfig['agents'] | (() => EvalConfig['agents'])
): AppSettings {
  const candidate = { ...settings };
  // Older clients send the assistant setting under its previous name.
  const assistantAgentKey = Object.prototype.hasOwnProperty.call(body, 'assistantAgentName')
    ? 'assistantAgentName'
    : Object.prototype.hasOwnProperty.call(body, 'scenarioAssistantAgentName')
      ? 'scenarioAssistantAgentName'
      : undefined;
  if (assistantAgentKey) {
    candidate.assistantAgentName = normalizeAgentName(body[assistantAgentKey], 'Assistant agent');
  }
  let libraryAgents: EvalConfig['agents'] | undefined;
  const getAgents = () => (libraryAgents ??= typeof agents === 'function' ? agents() : agents);
  if (Object.prototype.hasOwnProperty.call(body, 'defaultEvaluationAgentName')) {
    candidate.defaultEvaluationAgentName = normalizeAgentName(
      body.defaultEvaluationAgentName,
      'Default evaluation agent'
    );
    if (candidate.defaultEvaluationAgentName) {
      resolveDefaultEvaluationAgent({
        agents: getAgents(),
        defaultEvaluationAgentName: candidate.defaultEvaluationAgentName
      });
    }
  }
  const hasJudge = Object.prototype.hasOwnProperty.call(body, 'evaluationJudgeAgentName');
  const hasDecision = Object.prototype.hasOwnProperty.call(body, 'evaluationDecision');
  if (hasJudge) {
    candidate.evaluationJudgeAgentName = normalizeAgentName(
      body.evaluationJudgeAgentName,
      'Evaluation judge'
    );
  }
  if (hasDecision) {
    candidate.evaluationDecision =
      body.evaluationDecision === null
        ? undefined
        : normalizeEvaluationDecisionConfig(body.evaluationDecision);
  }
  const engineEnabled = isDecisionEngineEnabled(candidate.evaluationDecision);
  if (hasJudge || (hasDecision && engineEnabled)) {
    const judge = resolveEvaluationJudge({
      agents: candidate.evaluationJudgeAgentName ? getAgents() : {},
      evaluationJudgeAgentName: candidate.evaluationJudgeAgentName
    });
    if (engineEnabled && !judge) {
      throw new Error('Decision engines require a configured LLM evaluation judge as backup.');
    }
  }
  return candidate;
}

export function persistSettingsOverrides(settings: AppSettings): void {
  const payload: WorkspaceSettingsOverrides = {
    ...(settings.defaultEvaluationAgentName
      ? { default_evaluation_agent_name: settings.defaultEvaluationAgentName }
      : {}),
    default_queue_workers: normalizeQueueWorkerCount(settings.defaultQueueWorkers),
    ...(settings.assistantAgentName ? { assistant_agent_name: settings.assistantAgentName } : {}),
    ...(settings.evaluationJudgeAgentName
      ? { evaluation_judge_agent_name: settings.evaluationJudgeAgentName }
      : {}),
    ...(settings.evaluationDecision ? { evaluation_decision: settings.evaluationDecision } : {})
  };
  writeFileSync(settingsOverridesFilePath(settings), `${stringifyYaml(payload)}\n`, 'utf8');
}
