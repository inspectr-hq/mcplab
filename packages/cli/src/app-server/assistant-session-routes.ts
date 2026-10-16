import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AssistantRuntimeResponse } from '@inspectr/mcplab-core';
import { throwIfAborted } from './assistant-common.js';
import {
  createAssistantRequestAbortController,
  endAssistantSseClients,
  serveAssistantSseStream,
  type AssistantSseSessionState
} from './assistant-events.js';
import type { AssistantRuntimeSession } from './assistant-runtime-contract.js';

export interface AssistantHttpSession extends AssistantSseSessionState {
  id: string;
  runtime: AssistantRuntimeSession;
}

export interface AssistantSessionRouteOptions<TSession extends AssistantHttpSession> {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  prefix: string;
  assistantLabel: string;
  parseBody(req: IncomingMessage): Promise<unknown>;
  asJson(res: ServerResponse, status: number, body: unknown): void;
  sessions: Map<string, TSession>;
  cleanup(): void;
  touch(session: TSession): void;
  view(session: TSession): unknown;
  finish?(session: TSession): void;
  approveAll?: boolean;
}

export async function handleAssistantSessionRoutes<TSession extends AssistantHttpSession>(
  options: AssistantSessionRouteOptions<TSession>
): Promise<boolean> {
  const { req, res, pathname, method, prefix, sessions, asJson } = options;
  const missingSessionMessage = `${options.assistantLabel} session not found`;
  if (!pathname.startsWith(`${prefix}/`)) return false;
  const parts = pathname.slice(prefix.length + 1).split('/');
  const sessionId = parts[0] ?? '';
  const isEvents = method === 'GET' && parts[1] === 'events' && parts.length === 2;
  const isSessionRead = method === 'GET' && parts.length === 1;
  const isSessionDelete = method === 'DELETE' && parts.length === 1;
  const isMessage = method === 'POST' && parts[1] === 'messages' && parts.length === 2;
  const isCancel =
    method === 'POST' && parts[1] === 'turns' && parts[3] === 'cancel' && parts.length === 4;
  const isToolDecision =
    method === 'POST' &&
    parts[1] === 'tool-calls' &&
    parts.length === 4 &&
    ['approve', 'deny'].includes(parts[3]!);
  const isApproveAll =
    options.approveAll === true &&
    method === 'POST' &&
    parts[1] === 'tool-calls' &&
    parts[2] === 'approve-all' &&
    parts.length === 3;
  if (
    !sessionId ||
    (!isEvents &&
      !isSessionRead &&
      !isSessionDelete &&
      !isMessage &&
      !isCancel &&
      !isToolDecision &&
      !isApproveAll)
  ) {
    return false;
  }
  if (res.destroyed || res.writableEnded) return true;
  options.cleanup();
  if (isEvents) {
    const session = sessions.get(sessionId);
    if (!session) asJson(res, 404, { error: missingSessionMessage });
    else
      serveAssistantSseStream(req, res, session, {
        sessionId: session.id,
        session: options.view(session)
      });
    return true;
  }

  const session = sessions.get(sessionId);
  if (isSessionDelete) {
    const abort = createAssistantRequestAbortController(res);
    let disposeError: unknown;
    try {
      if (session) {
        try {
          await session.runtime.dispose();
        } catch (error) {
          disposeError = error;
        } finally {
          try {
            options.finish?.(session);
          } catch (error) {
            disposeError ??= error;
          } finally {
            endAssistantSseClients(session);
          }
        }
      }
      sessions.delete(sessionId);
      if (!abort.signal.aborted) {
        if (disposeError) asJson(res, 500, { error: errorMessage(disposeError) });
        else asJson(res, 200, { ok: true });
      }
    } finally {
      abort.dispose();
    }
    return true;
  }
  if (!session) {
    asJson(res, 404, { error: missingSessionMessage });
    return true;
  }
  if (isSessionRead) {
    options.touch(session);
    asJson(res, 200, { session: options.view(session) });
    return true;
  }
  if (isCancel) {
    await session.runtime.cancel(parts[2]!);
    options.touch(session);
    if (!res.destroyed && !res.writableEnded) asJson(res, 200, { ok: true });
    return true;
  }
  const respondWithRuntime = async (
    operation: (signal: AbortSignal) => Promise<AssistantRuntimeResponse | undefined>
  ) => {
    const abort = createAssistantRequestAbortController(res);
    try {
      throwIfAborted(abort.signal);
      const response = await operation(abort.signal);
      throwIfAborted(abort.signal);
      if (response !== undefined) {
        asJson(res, 200, {
          session: options.view(session),
          response: formatAssistantRuntimeResponse(response)
        });
      }
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    } finally {
      abort.dispose();
    }
  };
  if (isMessage) {
    await respondWithRuntime(async (signal) => {
      const body = await options.parseBody(req);
      throwIfAborted(signal);
      if (!isPlainObject(body) || typeof body.message !== 'string' || !body.message.trim()) {
        asJson(res, 400, { error: 'message is required' });
        return undefined;
      }
      if (
        body.turnId !== undefined &&
        (typeof body.turnId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(body.turnId))
      ) {
        asJson(res, 400, {
          error: 'turnId must be a non-empty identifier of at most 128 characters'
        });
        return undefined;
      }
      return body.turnId === undefined
        ? session.runtime.sendMessage(body.message.trim(), signal)
        : session.runtime.sendMessage(body.message.trim(), signal, body.turnId as string);
    });
    return true;
  }
  if (isToolDecision) {
    const callId = parts[2]!;
    const pending = session.runtime
      .getSnapshot()
      .pendingToolCalls.find((call) => call.id === callId);
    if (!pending) {
      asJson(res, 404, {
        error: `${options.assistantLabel} tool call not found`
      });
      return true;
    }
    if (pending.status !== 'pending') {
      asJson(res, 409, { error: `Tool call is already ${pending.status}` });
      return true;
    }
    const decision = parts[3] as 'approve' | 'deny';
    await respondWithRuntime(async (signal) => {
      const body = decision === 'approve' ? await options.parseBody(req) : {};
      throwIfAborted(signal);
      if (!isPlainObject(body)) {
        asJson(res, 400, { error: 'Invalid request body' });
        return undefined;
      }
      return session.runtime.resolveToolCalls(
        [
          {
            toolCallId: pending.id,
            decision,
            ...(decision === 'approve' &&
            Object.prototype.hasOwnProperty.call(body, 'argumentsOverride')
              ? { arguments: body.argumentsOverride }
              : {})
          }
        ],
        signal
      );
    });
    return true;
  }
  if (isApproveAll) {
    const pending = session.runtime
      .getSnapshot()
      .pendingToolCalls.filter((call) => call.status === 'pending');
    if (!pending.length) {
      asJson(res, 409, { error: 'No pending tool calls to approve' });
      return true;
    }
    await respondWithRuntime((signal) =>
      session.runtime.resolveToolCalls(
        pending.map((call) => ({ toolCallId: call.id, decision: 'approve' as const })),
        signal
      )
    );
    return true;
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function formatAssistantRuntimeResponse(
  response: AssistantRuntimeResponse
): AssistantRuntimeResponse {
  return response.type === 'tool_call_request' || response.type === 'tool_call_resolved'
    ? { ...response, pendingToolCall: response.pendingToolCalls[0] }
    : response;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
