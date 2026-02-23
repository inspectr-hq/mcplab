import type {
  CoreEvalConfig,
  CoreResultsJson,
  ScenarioAssistantSessionView,
  ScenarioAssistantTurnResponse,
  RunJobEvent,
  SnapshotComparison,
  SnapshotRecord,
  TraceUiEvent,
  ProviderModelsResponse,
  OAuthDebuggerSessionConfig,
  OAuthDebuggerSessionEvent,
  OAuthDebuggerSessionView,
  ToolAnalysisDiscoverResponse,
  ToolAnalysisReport,
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

async function requestText(path: string, init?: RequestInit): Promise<string> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}): ${body}`);
  }
  return response.text();
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
      scenarioAssistantAgentName?: string;
    }>('/api/settings'),
  updateSettings: (patch: {
    scenarioAssistantAgentName?: string;
  }) =>
    request<{
      workspaceRoot: string;
      configsDir: string;
      runsDir: string;
      snapshotsDir: string;
      librariesDir: string;
      scenarioAssistantAgentName?: string;
    }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch)
    }),
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
  deleteRun: (runId: string) =>
    request<{ ok: boolean }>(`/api/runs/${runId}`, { method: 'DELETE' }),
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
  askResultAssistant: (runId: string, messages: Array<{ role: 'user' | 'assistant'; text: string }>) =>
    request<{ reply: string; assistantAgentName: string; provider: string; model: string }>(
      `/api/runs/${encodeURIComponent(runId)}/assistant`,
      {
        method: 'POST',
        body: JSON.stringify({ messages })
      }
    ),
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
  listProviderModels: (provider: 'anthropic' | 'openai' | 'azure') =>
    request<ProviderModelsResponse>(
      `/api/providers/models?provider=${encodeURIComponent(provider)}`
    ),
  createScenarioAssistantSession: (params: {
    configId?: string;
    configPath?: string;
    scenarioId: string;
    selectedAssistantAgentName: string;
    context: unknown;
  }) =>
    request<{ sessionId: string; session: ScenarioAssistantSessionView }>(
      '/api/scenario-assistant/sessions',
      {
        method: 'POST',
        body: JSON.stringify(params)
      }
    ),
  getScenarioAssistantSession: (sessionId: string) =>
    request<{ session: ScenarioAssistantSessionView }>(
      `/api/scenario-assistant/sessions/${sessionId}`
    ),
  sendScenarioAssistantMessage: (sessionId: string, message: string) =>
    request<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>(
      `/api/scenario-assistant/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ message })
      }
    ),
  approveScenarioAssistantToolCall: (sessionId: string, callId: string) =>
    request<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>(
      `/api/scenario-assistant/sessions/${sessionId}/tool-calls/${callId}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({})
      }
    ),
  denyScenarioAssistantToolCall: (sessionId: string, callId: string) =>
    request<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>(
      `/api/scenario-assistant/sessions/${sessionId}/tool-calls/${callId}/deny`,
      {
        method: 'POST',
        body: JSON.stringify({})
      }
    ),
  closeScenarioAssistantSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/scenario-assistant/sessions/${sessionId}`, {
      method: 'DELETE'
    }),
  discoverToolsForAnalysis: (params: { serverNames: string[] }) =>
    request<ToolAnalysisDiscoverResponse>('/api/tool-analysis/discover-tools', {
      method: 'POST',
      body: JSON.stringify(params)
    }),
  startToolAnalysis: (params: {
    assistantAgentName?: string;
    serverNames: string[];
    selectedToolsByServer?: Record<string, string[]>;
    modes: { metadataReview: boolean; deeperAnalysis: boolean };
    deeperAnalysisOptions?: {
      autoRunPolicy: 'read_only_allowlist';
      sampleCallsPerTool?: number;
      toolCallTimeoutMs?: number;
    };
  }) =>
    request<{ jobId: string }>('/api/tool-analysis/jobs', {
      method: 'POST',
      body: JSON.stringify(params)
    }),
  getToolAnalysisResult: (jobId: string) =>
    request<{ jobId: string; report: ToolAnalysisReport }>(
      `/api/tool-analysis/jobs/${jobId}/result`
    ),
  stopToolAnalysis: (jobId: string) =>
    request<{ ok: boolean; status: 'running' | 'completed' | 'error' | 'stopped' }>(
      `/api/tool-analysis/jobs/${jobId}/stop`,
      {
        method: 'POST'
      }
    ),
  subscribeToolAnalysisJob: (jobId: string, onEvent: (event: RunJobEvent) => void) => {
    const source = new EventSource(`${BASE}/api/tool-analysis/jobs/${jobId}/events`);
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
        if (parsed.type === 'completed' || parsed.type === 'error') close();
      } catch {
        // ignore malformed payload
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
    return () => close();
  },
  createOAuthDebuggerSession: (config: OAuthDebuggerSessionConfig) =>
    request<{ sessionId: string; session: OAuthDebuggerSessionView }>(
      '/api/oauth-debugger/sessions',
      {
        method: 'POST',
        body: JSON.stringify(config)
      }
    ),
  getOAuthDebuggerSession: (sessionId: string) =>
    request<{ session: OAuthDebuggerSessionView }>(`/api/oauth-debugger/sessions/${sessionId}`),
  startOAuthDebuggerSession: (sessionId: string) =>
    request<{ session: OAuthDebuggerSessionView }>(
      `/api/oauth-debugger/sessions/${sessionId}/start`,
      {
        method: 'POST',
        body: JSON.stringify({})
      }
    ),
  subscribeOAuthDebuggerSession: (
    sessionId: string,
    onEvent: (event: OAuthDebuggerSessionEvent) => void
  ) => {
    const source = new EventSource(`${BASE}/api/oauth-debugger/sessions/${sessionId}/events`);
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
        const parsed = JSON.parse(event.data) as OAuthDebuggerSessionEvent;
        onEvent(parsed);
        if (parsed.type === 'completed' || parsed.type === 'error' || parsed.type === 'stopped') {
          close();
        }
      } catch {
        // ignore malformed payload
      }
    };
    [
      'started',
      'step_started',
      'step_completed',
      'step_failed',
      'http_request',
      'http_response',
      'validation',
      'log',
      'waiting_for_user',
      'waiting_for_browser_callback',
      'completed',
      'error',
      'stopped'
    ].forEach((type) => source.addEventListener(type, messageHandler));
    source.onerror = () => {
      if (closed) return;
      onEvent({
        type: 'error',
        ts: new Date().toISOString(),
        payload: { message: 'SSE connection error' }
      });
      close();
    };
    return () => close();
  },
  submitOAuthDebuggerManualCallback: (
    sessionId: string,
    payload: { redirectUrl?: string; code?: string; state?: string }
  ) =>
    request<{ session: OAuthDebuggerSessionView }>(
      `/api/oauth-debugger/sessions/${sessionId}/manual-callback`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    ),
  stopOAuthDebuggerSession: (sessionId: string) =>
    request<{ ok: boolean; status: OAuthDebuggerSessionView['status'] }>(
      `/api/oauth-debugger/sessions/${sessionId}/stop`,
      { method: 'POST', body: JSON.stringify({}) }
    ),
  exportOAuthDebuggerSession: (sessionId: string, format: 'json' | 'markdown' | 'raw') =>
    format === 'json'
      ? request<{ session: OAuthDebuggerSessionView; raw: unknown }>(
          `/api/oauth-debugger/sessions/${sessionId}/export?format=json`
        )
      : requestText(`/api/oauth-debugger/sessions/${sessionId}/export?format=${format}`),
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
