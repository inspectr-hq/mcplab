import type {
  CoreEvalConfig,
  CoreSourceEvalConfig,
  CoreResultsJson,
  ScenarioAttachment,
  ScenarioRunTraceRecord,
  ScenarioAssistantSessionView,
  ScenarioAssistantTurnResponse,
  RunJobEvent,
  RunQueueSseEvent,
  QueueResponse,
  ProviderModelsResponse,
  OAuthDebuggerSessionConfig,
  OAuthDebuggerSessionEvent,
  OAuthDebuggerSessionView,
  OAuthEnsureServerStatus,
  OAuthRuntimeSessionView,
  ToolAnalysisDiscoverResponse,
  ToolAnalysisReport,
  ToolAnalysisResultSummary,
  ListEnvelope,
  SavedToolAnalysisReportRecord,
  WorkspaceConfigRecord,
  WorkspaceRunSummary,
  MarkdownReportSummary,
  MarkdownReportContent,
  ResultAssistantApplyReportResponse,
  ResultAssistantSessionView,
  ResultAssistantTurnResponse,
  ResultAssistantSseEvent,
  ScenarioPreviewCoreRunResponse,
  WorkspaceHealthResponse,
  CoreLibraryBundle,
  ScenarioAssistantSseEvent
} from './types';

function getBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  if (window.location.port === '8685') {
    return 'http://127.0.0.1:8787';
  }
  return '';
}

const BASE = getBaseUrl();

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

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
    throw new ApiError(response.status, `Request failed (${response.status}): ${body}`);
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
    throw new ApiError(response.status, `Request failed (${response.status}): ${body}`);
  }
  return response.text();
}

function subscribeAssistantSessionEvents<TEvent extends { type: string }>(
  path: string,
  onEvent: (event: TEvent) => void
): () => void {
  const source = new EventSource(`${BASE}${path}`);
  const terminalSessionPath = path.replace(/\/events$/, '');
  const eventTypes = [
    'session_started',
    'turn_started',
    'tool_call_requested',
    'tool_call_approved',
    'tool_call_denied',
    'tool_call_resolved',
    'assistant_message_completed',
    'session_warning',
    'session_error',
    'session_finished'
  ] as const;
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
      const parsed = JSON.parse(event.data) as TEvent;
      if (parsed.type === 'session_finished') close();
      onEvent(parsed);
    } catch {
      // Ignore malformed or non-JSON assistant SSE payloads.
    }
  };
  for (const eventType of eventTypes) {
    source.addEventListener(eventType, messageHandler);
  }
  // Only close permanently when EventSource has given up (readyState CLOSED = 2).
  // Transient errors (readyState CONNECTING = 0) let the browser auto-reconnect;
  // the server replays session.events on reconnect so no events are lost.
  source.onerror = () => {
    if (closed) return;
    if (source.readyState === 2) {
      close();
      return;
    }
    void fetch(`${BASE}${terminalSessionPath}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        accept: 'application/json'
      }
    })
      .then((response) => {
        if (response.status === 404 || response.status === 410) {
          close();
        }
      })
      .catch(() => {
        // Keep retrying on transient network failures.
      });
  };
  return () => close();
}

function appendPositiveIntegerParam(query: URLSearchParams, key: string, value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  const normalized = Math.floor(value);
  if (normalized <= 0) return;
  query.set(key, String(normalized));
}

function appendNonNegativeIntegerParam(query: URLSearchParams, key: string, value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  const normalized = Math.floor(value);
  if (normalized < 0) return;
  query.set(key, String(normalized));
}

export const workspaceApiClient = {
  health: () => request<WorkspaceHealthResponse>('/api/health'),
  getSettings: () =>
    request<{
      workspaceRoot: string;
      evalsDir: string;
      runsDir: string;
      librariesDir: string;
      defaultQueueWorkers: number;
      scenarioAssistantAgentName?: string;
      evaluationJudgeAgentName?: string;
    }>('/api/settings'),
  updateSettings: (patch: {
    defaultQueueWorkers?: number;
    scenarioAssistantAgentName?: string;
    evaluationJudgeAgentName?: string;
  }) =>
    request<{
      workspaceRoot: string;
      evalsDir: string;
      runsDir: string;
      librariesDir: string;
      defaultQueueWorkers: number;
      scenarioAssistantAgentName?: string;
      evaluationJudgeAgentName?: string;
    }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch)
    }),
  listConfigs: () => request<WorkspaceConfigRecord[]>('/api/evals'),
  createConfig: (fileName: string, config: CoreSourceEvalConfig) =>
    request<WorkspaceConfigRecord>('/api/evals', {
      method: 'POST',
      body: JSON.stringify({ fileName, config })
    }),
  updateConfig: (id: string, config: CoreSourceEvalConfig, fileName?: string) =>
    request<WorkspaceConfigRecord>(`/api/evals/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ config, fileName })
    }),
  deleteConfig: (id: string) => request<{ ok: boolean }>(`/api/evals/${id}`, { method: 'DELETE' }),
  listRuns: (filter?: {
    since?: string;
    until?: string;
    lastDays?: number;
    scenario?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (filter?.since?.trim()) query.set('since', filter.since.trim());
    if (filter?.until?.trim()) query.set('until', filter.until.trim());
    if (
      typeof filter?.lastDays === 'number' &&
      Number.isFinite(filter.lastDays) &&
      filter.lastDays > 0
    ) {
      query.set('last_days', String(Math.floor(filter.lastDays)));
    }
    if (filter?.scenario?.trim()) query.set('scenario', filter.scenario.trim());
    appendPositiveIntegerParam(query, 'limit', filter?.limit);
    appendNonNegativeIntegerParam(query, 'offset', filter?.offset);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return request<ListEnvelope<WorkspaceRunSummary>>(`/api/runs${suffix}`);
  },
  getLatestPassRatesByConfigIds: (params: {
    lastDays?: number;
    configs: Array<{
      id: string;
      sourcePath?: string;
      relativePath?: string;
      configHash?: string;
    }>;
  }) =>
    request<{ byConfigId: Record<string, number> }>('/api/runs/latest-pass-rates', {
      method: 'POST',
      body: JSON.stringify(params)
    }).then((response) => response.byConfigId),
  listMarkdownReports: (params?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    appendPositiveIntegerParam(query, 'limit', params?.limit);
    appendNonNegativeIntegerParam(query, 'offset', params?.offset);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return request<ListEnvelope<MarkdownReportSummary>>(`/api/markdown-reports${suffix}`);
  },
  listToolAnalysisServers: () =>
    request<{ object: 'list'; data: string[] }>('/api/tool-analysis-results/servers').then(
      (response) => response.data
    ),
  getMarkdownReport: (path: string) =>
    request<MarkdownReportContent>(
      `/api/markdown-reports/content?path=${encodeURIComponent(path)}`
    ),
  getMarkdownReportById: (reportId: string) =>
    request<MarkdownReportContent>(`/api/markdown-reports/${encodeURIComponent(reportId)}`),
  deleteMarkdownReport: (path: string) =>
    request<{ ok: boolean }>(`/api/markdown-reports?path=${encodeURIComponent(path)}`, {
      method: 'DELETE'
    }).then(() => undefined),
  getRun: (runId: string) =>
    request<{ runId: string; results: CoreResultsJson }>(`/api/runs/${runId}`),
  deleteRun: (runId: string) =>
    request<{ ok: boolean }>(`/api/runs/${runId}`, { method: 'DELETE' }),
  updateRunNote: (runId: string, runNote?: string) =>
    request<{ ok: boolean }>(`/api/runs/${encodeURIComponent(runId)}/note`, {
      method: 'PATCH',
      body: JSON.stringify({ runNote: runNote ?? '' })
    }).then(() => undefined),
  getRunTrace: (runId: string) =>
    request<{ runId: string; records: ScenarioRunTraceRecord[] }>(`/api/runs/${runId}/trace`),
  applyResultAssistantReport: (params: {
    runId: string;
    markdown: string;
    outputPath?: string;
    overwrite?: boolean;
  }) =>
    request<ResultAssistantApplyReportResponse>(
      `/api/runs/${encodeURIComponent(params.runId)}/assistant/apply-report`,
      {
        method: 'POST',
        body: JSON.stringify({
          markdown: params.markdown,
          outputPath: params.outputPath,
          overwrite: params.overwrite
        })
      }
    ),
  createResultAssistantSession: (
    params: { runId?: string; scope?: 'run' | 'all_runs' },
    signal?: AbortSignal
  ) =>
    request<{ sessionId: string; session: ResultAssistantSessionView }>(
      '/api/result-assistant/sessions',
      {
        method: 'POST',
        body: JSON.stringify(params),
        signal
      }
    ),
  getResultAssistantSession: (sessionId: string) =>
    request<{ session: ResultAssistantSessionView }>(`/api/result-assistant/sessions/${sessionId}`),
  sendResultAssistantMessage: (sessionId: string, message: string, signal?: AbortSignal) =>
    request<{ session: ResultAssistantSessionView; response: ResultAssistantTurnResponse }>(
      `/api/result-assistant/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
        signal
      }
    ),
  approveResultAssistantToolCall: (
    sessionId: string,
    callId: string,
    argumentsOverride?: unknown
  ) =>
    request<{ session: ResultAssistantSessionView; response: ResultAssistantTurnResponse }>(
      `/api/result-assistant/sessions/${sessionId}/tool-calls/${callId}/approve`,
      {
        method: 'POST',
        body: JSON.stringify(argumentsOverride === undefined ? {} : { argumentsOverride })
      }
    ),
  denyResultAssistantToolCall: (sessionId: string, callId: string) =>
    request<{ session: ResultAssistantSessionView; response: ResultAssistantTurnResponse }>(
      `/api/result-assistant/sessions/${sessionId}/tool-calls/${callId}/deny`,
      {
        method: 'POST',
        body: JSON.stringify({})
      }
    ),
  closeResultAssistantSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/result-assistant/sessions/${sessionId}`, {
      method: 'DELETE'
    }).then(() => undefined),
  subscribeResultAssistantSessionEvents: (
    sessionId: string,
    onEvent: (event: ResultAssistantSseEvent) => void
  ) =>
    subscribeAssistantSessionEvents(`/api/result-assistant/sessions/${sessionId}/events`, onEvent),
  getLibraries: () => request<CoreLibraryBundle>('/api/libraries'),
  saveLibraries: (libraries: CoreLibraryBundle) =>
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
    runNote?: string;
    serverOverrideAll?: string[];
    scenarioServerOverrides?: Record<string, string[]>;
  }) =>
    request<{ jobId: string; queued?: boolean; position?: number }>('/api/runs', {
      method: 'POST',
      body: JSON.stringify(params)
    }),
  runScenarioPreview: (params: {
    selectedAgentName: string;
    scenario: {
      id: string;
      name: string;
      prompt: string;
      serverNames: string[];
      attachments: ScenarioAttachment[];
      evalRules: Array<{
        type: string;
        value?: string;
        sequence?: string[];
        path?: string;
        equals?: string | number | boolean;
        label?: string;
        prompt?: string;
      }>;
      extractRules: Array<{ name: string; pattern: string }>;
    };
  }) =>
    request<ScenarioPreviewCoreRunResponse>('/api/runs/preview', {
      method: 'POST',
      body: JSON.stringify(params)
    }),
  listProviderModels: (provider: 'anthropic' | 'openai' | 'azure') =>
    request<ProviderModelsResponse>(
      `/api/providers/models?provider=${encodeURIComponent(provider)}`
    ),
  createScenarioAssistantSession: (
    params: {
      configId?: string;
      configPath?: string;
      scenarioId: string;
      selectedAssistantAgentName: string;
      context: unknown;
    },
    signal?: AbortSignal
  ) =>
    request<{ sessionId: string; session: ScenarioAssistantSessionView }>(
      '/api/scenario-assistant/sessions',
      {
        method: 'POST',
        body: JSON.stringify(params),
        signal
      }
    ),
  getScenarioAssistantSession: (sessionId: string) =>
    request<{ session: ScenarioAssistantSessionView }>(
      `/api/scenario-assistant/sessions/${sessionId}`
    ),
  sendScenarioAssistantMessage: (sessionId: string, message: string, signal?: AbortSignal) =>
    request<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>(
      `/api/scenario-assistant/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
        signal
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
  approveAllScenarioAssistantToolCalls: (sessionId: string) =>
    request<{ session: ScenarioAssistantSessionView; response: ScenarioAssistantTurnResponse }>(
      `/api/scenario-assistant/sessions/${sessionId}/tool-calls/approve-all`,
      {
        method: 'POST',
        body: JSON.stringify({})
      }
    ),
  closeScenarioAssistantSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/scenario-assistant/sessions/${sessionId}`, {
      method: 'DELETE'
    }),
  subscribeScenarioAssistantSessionEvents: (
    sessionId: string,
    onEvent: (event: ScenarioAssistantSseEvent) => void
  ) =>
    subscribeAssistantSessionEvents(
      `/api/scenario-assistant/sessions/${sessionId}/events`,
      onEvent
    ),
  discoverToolsForAnalysis: (params: { serverNames: string[] }) =>
    request<ToolAnalysisDiscoverResponse>('/api/tool-analysis/discover-tools', {
      method: 'POST',
      body: JSON.stringify(params)
    }),
  startToolAnalysis: (params: {
    assistantAgentName?: string;
    serverNames: string[];
    selectedToolsByServer?: Record<string, string[]>;
    maxParallelTools?: number;
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
    request<{ jobId: string; report: ToolAnalysisReport; savedReportId?: string }>(
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
  listToolAnalysisResults: (params?: { limit?: number; offset?: number; server?: string }) => {
    const query = new URLSearchParams();
    appendPositiveIntegerParam(query, 'limit', params?.limit);
    appendNonNegativeIntegerParam(query, 'offset', params?.offset);
    if (params?.server?.trim()) query.set('server', params.server.trim());
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return request<ListEnvelope<ToolAnalysisResultSummary>>(`/api/tool-analysis-results${suffix}`);
  },
  getToolAnalysisSavedResult: (id: string) =>
    request<SavedToolAnalysisReportRecord>(`/api/tool-analysis-results/${id}`),
  deleteToolAnalysisSavedResult: (id: string) =>
    request<{ ok: boolean }>(`/api/tool-analysis-results/${id}`, { method: 'DELETE' }).then(
      () => undefined
    ),
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
  createOAuthRuntimeSession: (params: { serverName: string }) =>
    request<{ session: OAuthRuntimeSessionView }>('/api/oauth-runtime/sessions', {
      method: 'POST',
      body: JSON.stringify(params)
    }),
  getOAuthRuntimeSession: (sessionId: string) =>
    request<{ session: OAuthRuntimeSessionView }>(`/api/oauth-runtime/sessions/${sessionId}`),
  getOAuthRuntimeSessionToken: (sessionId: string) =>
    request<{ accessToken: string }>(`/api/oauth-runtime/sessions/${sessionId}/token`),
  submitOAuthRuntimeCallback: (
    sessionId: string,
    payload: { redirectUrl?: string; code?: string; state?: string }
  ) =>
    request<{ session: OAuthRuntimeSessionView }>(
      `/api/oauth-runtime/sessions/${sessionId}/callback`,
      {
        method: 'POST',
        body: JSON.stringify(payload)
      }
    ),
  cancelOAuthRuntimeSession: (sessionId: string) =>
    request<{ session: OAuthRuntimeSessionView }>(
      `/api/oauth-runtime/sessions/${sessionId}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({})
      }
    ),
  ensureOAuthServers: (params: { serverNames: string[] }) =>
    request<{ servers: OAuthEnsureServerStatus[]; allReady: boolean }>(
      '/api/oauth-runtime/servers/ensure',
      {
        method: 'POST',
        body: JSON.stringify(params)
      }
    ),
  stopRun: (jobId: string) =>
    request<{ ok: boolean }>(`/api/runs/jobs/${jobId}/stop`, {
      method: 'POST'
    }),
  getRunQueue: () => request<QueueResponse>('/api/runs/queue'),
  subscribeRunQueue: (onEvent: (event: RunQueueSseEvent) => void) => {
    if (typeof SharedWorker === 'undefined') {
      // Fallback for Safari < 16 and other environments without SharedWorker support.
      const sse = new EventSource(`${BASE}/api/runs/queue/events`);
      let closed = false;
      sse.onopen = () => {
        if (closed) return;
        onEvent({
          type: 'connected',
          ts: new Date().toISOString(),
          payload: { message: 'SSE connected' }
        });
      };
      sse.addEventListener('queue_event', (event: MessageEvent) => {
        if (closed) return;
        try {
          onEvent(JSON.parse(event.data));
        } catch {
          /* ignore malformed */
        }
      });
      sse.onerror = () => {
        if (closed) return;
        onEvent({
          type: 'error',
          ts: new Date().toISOString(),
          payload: { message: 'SSE connection error', reconnecting: sse.readyState !== 2 }
        });
        if (sse.readyState === 2) {
          sse.onerror = null;
          closed = true;
        }
      };
      return () => {
        if (closed) return;
        closed = true;
        sse.close();
      };
    }

    const worker = new SharedWorker(new URL('./sse-queue-worker.ts', import.meta.url), {
      type: 'module'
    });
    let closed = false;

    worker.onerror = () => {
      if (closed) return;
      onEvent({
        type: 'error',
        ts: new Date().toISOString(),
        payload: { message: 'Queue worker failed to load' }
      });
    };

    worker.port.onmessage = (event: MessageEvent) => {
      if (closed) return;
      if (typeof event.data !== 'object' || !event.data) return;
      if (event.data.type === 'ping') {
        worker.port.postMessage({ type: 'pong' });
        return;
      }
      onEvent(event.data as RunQueueSseEvent);
    };

    worker.port.start();
    worker.port.postMessage({ type: 'init', baseUrl: BASE });

    return () => {
      if (closed) return;
      closed = true;
      worker.port.postMessage({ type: 'close' });
      worker.port.onmessage = null;
      worker.port.close();
    };
  },
  removeQueuedRun: (jobId: string) =>
    request<{ ok: boolean }>(`/api/runs/queue/${jobId}`, { method: 'DELETE' }).then(
      () => undefined
    ),
  resumeQueue: () => request<{ ok: boolean }>('/api/runs/queue/resume', { method: 'POST' }),
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
    source.addEventListener('queued', messageHandler);
    source.addEventListener('started', messageHandler);
    source.addEventListener('log', messageHandler);
    source.addEventListener('completed', messageHandler);
    source.addEventListener('error', messageHandler);
    source.addEventListener('oauth_required', messageHandler);
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
