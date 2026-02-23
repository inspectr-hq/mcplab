import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { AppSettings } from './types.js';

interface AppSettingsOverrides {
  scenario_assistant_agent_name?: string;
}

function settingsOverridesFilePath(settings: AppSettings): string {
  return join(settings.librariesDir, '.mcplab-app-settings.yaml');
}

function loadSettingsOverrides(settings: AppSettings): AppSettingsOverrides {
  const filePath = settingsOverridesFilePath(settings);
  if (!existsSync(filePath)) return {};
  try {
    const parsed = parseYaml(readFileSync(filePath, 'utf8')) as AppSettingsOverrides | undefined;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function applySettingsOverrides(settings: AppSettings): void {
  const overrides = loadSettingsOverrides(settings);
  settings.scenarioAssistantAgentName =
    overrides.scenario_assistant_agent_name?.trim() || undefined;
}

export function persistSettingsOverrides(settings: AppSettings): void {
  const payload: AppSettingsOverrides = {
    ...(settings.scenarioAssistantAgentName
      ? { scenario_assistant_agent_name: settings.scenarioAssistantAgentName }
      : {})
  };
  writeFileSync(settingsOverridesFilePath(settings), `${stringifyYaml(payload)}\n`, 'utf8');
}
