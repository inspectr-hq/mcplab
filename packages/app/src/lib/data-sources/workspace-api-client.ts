import type {
  CoreEvalConfig,
  CoreResultsJson,
  RunJobEvent,
  SnapshotComparison,
  SnapshotRecord,
  TraceUiEvent,
  RunPresetRecord,
  ProviderModelsResponse,
  WorkspaceConfigRecord,
  WorkspaceRunSummary
} from './types';

function getBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  if (window.location.port === '8685') {
    return 'http://127.0.0.1:8787';
  }
  return '';
}

const BASE = getBaseUrl();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}

export const workspaceApiClient = {
  health: () => request<{ ok: boolean; version: string }>('/api/health'),
  getSettings: () =>
    request<{
      workspaceRoot: string;
      configsDir: string;
      runsDir: string;
      snapshotsDir: string;
      librariesDir: string;
      runPresetsDir: string;
    }>('/api/settings'),
  listConfigs: () => request<WorkspaceConfigRecord[]>('/api/configs'),
  createConfig: (fileName: string, config: CoreEvalConfig) =>
    request<WorkspaceConfigRecord>('/api/configs', {
      method: 'POST',
      body: JSON.stringify({ fileName, config })
    }),
  updateConfig: (id: string, config: CoreEvalConfig, fileName?: string) =>
    request<WorkspaceConfigRecord>(`/api/configs/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ config, fileName })
    }),
  deleteConfig: (id: string) =>
    request<{ ok: boolean }>(`/api/configs/${id}`, { method: 'DELETE' }),
  listRuns: () => request<WorkspaceRunSummary[]>('/api/runs'),
  getRun: (runId: string) =>
    request<{ runId: string; results: CoreResultsJson }>(`/api/runs/${runId}`),
  getRunTrace: (runId: string) =>
    request<{ runId: string; events: TraceUiEvent[] }>(`/api/runs/${runId}/trace`),
  listSnapshots: () => request<SnapshotRecord[]>('/api/snapshots'),
  createSnapshotFromRun: (runId: string, name?: string) =>
    request<SnapshotRecord>('/api/snapshots', {
      method: 'POST',
      body: JSON.stringify({ runId, name })
    }),
  getSnapshot: (id: string) => request<SnapshotRecord>(`/api/snapshots/${id}`),
  compareSnapshot: (snapshotId: string, runId: string) =>
    request<SnapshotComparison>(`/api/snapshots/${snapshotId}/compare`, {
      method: 'POST',
      body: JSON.stringify({ runId })
    }),
  generateSnapshotEvalBaseline: (runId: string, configId: string, name?: string) =>
    request<{ snapshot: SnapshotRecord; config: WorkspaceConfigRecord }>(
      '/api/snapshots/generate-eval',
      {
        method: 'POST',
        body: JSON.stringify({ runId, configId, name })
      }
    ),
  updateSnapshotPolicy: (
    configId: string,
    policy: {
      enabled: boolean;
      mode: 'warn' | 'fail_on_drift';
      baselineSnapshotId?: string;
      baselineSourceRunId?: string;
    }
  ) =>
    request<WorkspaceConfigRecord>(`/api/configs/${configId}/snapshot-policy`, {
      method: 'POST',
      body: JSON.stringify(policy)
    }),
  getLibraries: () =>
    request<{
      servers: CoreEvalConfig['servers'];
      agents: CoreEvalConfig['agents'];
      scenarios: CoreEvalConfig['scenarios'];
    }>('/api/libraries'),
  saveLibraries: (libraries: {
    servers: CoreEvalConfig['servers'];
    agents: CoreEvalConfig['agents'];
    scenarios: CoreEvalConfig['scenarios'];
  }) =>
    request<{ ok: boolean }>('/api/libraries', {
      method: 'PUT',
      body: JSON.stringify(libraries)
    }),
  startRun: (params: {
    configPath: string;
    runsPerScenario: number;
    scenarioId?: string;
    scenarioIds?: string[];
    agents?: string[];
    applySnapshotEval?: boolean;
  }) =>
    request<{ jobId: string }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify(params)
    }),
  listRunPresets: () => request<RunPresetRecord[]>('/api/run-presets'),
  createRunPreset: (preset: Omit<RunPresetRecord, 'id' | 'created_at' | 'updated_at'>) =>
    request<RunPresetRecord>('/api/run-presets', {
      method: 'POST',
      body: JSON.stringify({ preset })
    }),
  updateRunPreset: (
    id: string,
    preset: Omit<RunPresetRecord, 'id' | 'created_at' | 'updated_at'>
  ) =>
    request<RunPresetRecord>(`/api/run-presets/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ preset })
    }),
  deleteRunPreset: (id: string) =>
    request<{ ok: boolean }>(`/api/run-presets/${id}`, { method: 'DELETE' }),
  listProviderModels: (provider: 'anthropic' | 'openai' | 'azure') =>
    request<ProviderModelsResponse>(`/api/providers/models?provider=${encodeURIComponent(provider)}`),
  stopRun: (jobId: string) =>
    request<{ ok: boolean }>(`/api/runs/jobs/${jobId}/stop`, {
      method: 'POST'
    }),
  subscribeRunJob: (jobId: string, onEvent: (event: RunJobEvent) => void) => {
    const source = new EventSource(`${BASE}/api/runs/jobs/${jobId}/events`);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      source.close();
    };
    const messageHandler = (event: MessageEvent) => {
      if (closed) return;
      if (typeof event.data !== 'string' || !event.data) return;
      try {
        const parsed = JSON.parse(event.data) as RunJobEvent;
        onEvent(parsed);
        if (parsed.type === 'completed' || parsed.type === 'error') {
          close();
        }
      } catch {
        // Ignore malformed or non-JSON SSE payloads.
      }
    };
    source.addEventListener('started', messageHandler);
    source.addEventListener('log', messageHandler);
    source.addEventListener('completed', messageHandler);
    source.addEventListener('error', messageHandler);
    source.onerror = () => {
      if (closed) return;
      onEvent({
        type: 'error',
        ts: new Date().toISOString(),
        payload: { message: 'SSE connection error' }
      });
      close();
    };
    return () => {
      close();
    };
  }
};
