import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AppSettings } from './types.js';

interface AppSettingsOverrides {
  scenario_assistant_agent_name?: string;
  global_copilot_agent_name?: string;
  evaluation_judge_agent_name?: string;
  default_queue_workers?: unknown;
}

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

export function loadWorkspaceSettingsOverrides(librariesDir: string): AppSettingsOverrides {
  const filePath = join(librariesDir, '.mcplab-app-settings.yaml');
  if (!existsSync(filePath)) return {};
  try {
    const parsed = parseYaml(readFileSync(filePath, 'utf8')) as AppSettingsOverrides | undefined;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function applySettingsOverrides(settings: AppSettings): void {
  const overrides = loadWorkspaceSettingsOverrides(settings.librariesDir);
  settings.defaultQueueWorkers = normalizeQueueWorkerCount(overrides.default_queue_workers);
  const envQueueWorkers = resolveEnvQueueWorkers();
  if (envQueueWorkers !== undefined) settings.defaultQueueWorkers = envQueueWorkers;
  settings.scenarioAssistantAgentName =
    overrides.scenario_assistant_agent_name?.trim() || undefined;
  settings.globalCopilotAgentName = overrides.global_copilot_agent_name?.trim() || undefined;
  settings.evaluationJudgeAgentName = overrides.evaluation_judge_agent_name?.trim() || undefined;
}

export function persistSettingsOverrides(settings: AppSettings): void {
  const payload: AppSettingsOverrides = {
    default_queue_workers: normalizeQueueWorkerCount(settings.defaultQueueWorkers),
    ...(settings.scenarioAssistantAgentName
      ? { scenario_assistant_agent_name: settings.scenarioAssistantAgentName }
      : {}),
    ...(settings.globalCopilotAgentName
      ? { global_copilot_agent_name: settings.globalCopilotAgentName }
      : {}),
    ...(settings.evaluationJudgeAgentName
      ? { evaluation_judge_agent_name: settings.evaluationJudgeAgentName }
      : {})
  };
  writeFileSync(settingsOverridesFilePath(settings), `${stringifyYaml(payload)}\n`, 'utf8');
}
