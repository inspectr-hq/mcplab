import { chatWithAgent } from './agent.js';
import { createAbortError, throwIfAborted } from './abort.js';
import { normalizeLibraryAgents } from './config.js';
import { isLlmAgent, type AgentConnectionTestResult } from './types.js';

/** Probe inference with a bounded synthetic prompt, independent of saving or evaluation. */
export async function testAgentConnection(
  raw: unknown,
  signal?: AbortSignal
): Promise<AgentConnectionTestResult> {
  throwIfAborted(signal);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('LLM agent configuration is required.');
  const input = raw as Record<string, unknown>;
  if (input.type === 'browser' || typeof input.model !== 'string' || !input.model.trim()) {
    throw new Error('Choose an LLM provider and enter a model or deployment name.');
  }
  const agent = normalizeLibraryAgents({
    probe: { provider: input.provider, model: input.model.trim(), max_tokens: 64 }
  }).probe;
  if (!isLlmAgent(agent)) throw new Error('Connection tests require an LLM agent.');
  const timeout = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const timer = setTimeout(() => timeout.abort(), 30_000);
  const started = Date.now();
  const base = { provider: agent.provider, requestedModel: agent.model };
  try {
    const response = await chatWithAgent({
      agent,
      messages: [{ role: 'user', content: 'Reply with Ready.' }],
      signal: requestSignal
    });
    throwIfAborted(signal);
    if (timeout.signal.aborted) throw createAbortError();
    const responseModel =
      response.raw && typeof response.raw === 'object'
        ? (response.raw as Record<string, unknown>).model
        : undefined;
    return {
      ...base,
      ok: true,
      message: 'The configured model or deployment returned an inference response.',
      ...(typeof responseModel === 'string' ? { model: responseModel } : {}),
      durationMs: Date.now() - started
    };
  } catch (error: unknown) {
    if (signal?.aborted) throw createAbortError();
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error && typeof error === 'object' ? (error as { status?: number }).status : undefined;
    let failure = 'connection_error';
    let hint = 'Check the backend endpoint and network access.';
    if (timeout.signal.aborted) {
      failure = 'timeout';
      hint = 'The inference request timed out after 30 seconds.';
    } else if (message.startsWith('Missing ')) {
      failure = 'missing_credentials';
      hint = 'Set the required backend environment variables and restart MCPLab.';
    } else if (status === 401 || status === 403) {
      failure = 'authentication';
      hint = 'Check credentials and access to the configured deployment.';
    } else if (status === 404) {
      failure = 'deployment';
      hint = 'Check the resource endpoint and exact deployment name.';
    } else if (status === 400 || status === 422) {
      failure = 'capability';
      hint = 'Check the deployment supports chat completions and the requested capabilities.';
    } else if (status === 429) {
      failure = 'rate_limit';
      hint = 'The deployment rate limit was reached. Try again later.';
    }
    return {
      ...base,
      ok: false,
      failure,
      message: timeout.signal.aborted ? hint : `${hint} ${message}`,
      durationMs: Date.now() - started
    };
  } finally {
    clearTimeout(timer);
  }
}
