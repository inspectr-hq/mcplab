import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AssistantRuntimeResponse, AssistantRuntimeSession } from '@inspectr/mcplab-core';
import { throwIfAborted } from './assistant-common.js';
import {
  createAssistantRequestAbortController,
  endAssistantSseClients,
  serveAssistantSseStream,
  type AssistantSseSessionState
} from './assistant-events.js';

export interface AssistantHttpSession extends AssistantSseSessionState {
  id: string;
  runtime?: AssistantRuntimeSession;
}

export interface AssistantSessionRouteOptions<TSession extends AssistantHttpSession> {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  prefix: string;
  missingSessionMessage: string;
  parseBody(req: IncomingMessage): Promise<any>;
  asJson(res: ServerResponse, status: number, body: unknown): void;
  sessions: Map<string, TSession>;
  cleanup(): void;
  touch(session: TSession): void;
  view(session: TSession): unknown;
  response(response: AssistantRuntimeResponse): unknown;
  finish?(session: TSession): void;
  afterDecision?(
    response: AssistantRuntimeResponse,
    decision: 'approve' | 'deny',
    toolName: string
  ): unknown;
  approveAll?: boolean;
  toolCallNotFoundMessage: string;
}

export async function handleAssistantSessionRoutes<TSession extends AssistantHttpSession>(
  options: AssistantSessionRouteOptions<TSession>
): Promise<boolean> {
  const { req, res, pathname, method, prefix, missingSessionMessage, sessions, asJson } = options;
  if (!pathname.startsWith(`${prefix}/`)) return false;
  const parts = pathname.slice(prefix.length + 1).split('/');
  const sessionId = parts[0] ?? '';
  const isEvents = parts[1] === 'events' && parts.length === 2;
  const isSessionRead = method === 'GET' && parts.length === 1;
  const isSessionDelete = method === 'DELETE' && parts.length === 1;
  const isMessage = method === 'POST' && parts[1] === 'messages' && parts.length === 2;
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
    (!(isEvents && method === 'GET') &&
      !isSessionRead &&
      !isSessionDelete &&
      !isMessage &&
      !isToolDecision &&
      !isApproveAll)
  ) {
    return false;
  }
  if (res.destroyed || res.writableEnded) return true;
  options.cleanup();
  if (isEvents && method === 'GET') {
    const session = sessions.get(sessionId);
    if (!session) asJson(res, 404, { error: missingSessionMessage });
    else serveAssistantSseStream(req, res, session);
    return true;
  }

  const session = sessions.get(sessionId);
  if (isSessionDelete) {
    const abort = createAssistantRequestAbortController(res);
    let disposeError: unknown;
    try {
      if (session) {
        try {
          await session.runtime?.dispose();
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
    if (
      isSessionRead || isMessage || isToolDecision || isApproveAll || (isEvents && method === 'GET')
    ) {
      asJson(res, 404, { error: missingSessionMessage });
      return true;
    }
    return false;
  }
  if (isSessionRead) {
    options.touch(session);
    asJson(res, 200, { session: options.view(session) });
    return true;
  }
  if (isMessage) {
    const abort = createAssistantRequestAbortController(res);
    try {
      throwIfAborted(abort.signal);
      const body = await options.parseBody(req);
      const message = String(body.message ?? '').trim();
      throwIfAborted(abort.signal);
      if (!message) {
        asJson(res, 400, { error: 'message is required' });
        return true;
      }
      const response = await session.runtime!.sendMessage(message, abort.signal);
      throwIfAborted(abort.signal);
      asJson(res, 200, { session: options.view(session), response: options.response(response) });
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    } finally {
      abort.dispose();
    }
    return true;
  }
  if (
    method === 'POST' &&
    parts[1] === 'tool-calls' &&
    parts.length === 4 &&
    ['approve', 'deny'].includes(parts[3]!)
  ) {
    const callId = parts[2]!;
    const pending = session
      .runtime!.getSnapshot()
      .pendingToolCalls.find((call) => call.id === callId);
    if (!pending) {
      asJson(res, 404, {
        error: options.toolCallNotFoundMessage
      });
      return true;
    }
    if (pending.status !== 'pending') {
      asJson(res, 409, { error: `Tool call is already ${pending.status}` });
      return true;
    }
    const decision = parts[3] as 'approve' | 'deny';
    const abort = createAssistantRequestAbortController(res);
    try {
      throwIfAborted(abort.signal);
      const body = decision === 'approve' ? await options.parseBody(req) : {};
      throwIfAborted(abort.signal);
      const response = await session.runtime!.resolveToolCalls(
        [
          {
            toolCallId: pending.id,
            decision,
            ...(decision === 'approve' &&
            Object.prototype.hasOwnProperty.call(body ?? {}, 'argumentsOverride')
              ? { arguments: body.argumentsOverride }
              : {})
          }
        ],
        abort.signal
      );
      throwIfAborted(abort.signal);
      asJson(res, 200, {
        session: options.view(session),
        response:
          options.afterDecision?.(response, decision, pending.publicToolName) ??
          options.response(response)
      });
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    } finally {
      abort.dispose();
    }
    return true;
  }
  if (isApproveAll) {
    const pending = session
      .runtime!.getSnapshot()
      .pendingToolCalls.filter((call) => call.status === 'pending');
    if (!pending.length) {
      asJson(res, 409, { error: 'No pending tool calls to approve' });
      return true;
    }
    const abort = createAssistantRequestAbortController(res);
    try {
      throwIfAborted(abort.signal);
      const response = await session.runtime!.resolveToolCalls(
        pending.map((call) => ({ toolCallId: call.id, decision: 'approve' as const })),
        abort.signal
      );
      throwIfAborted(abort.signal);
      asJson(res, 200, { session: options.view(session), response: options.response(response) });
    } catch (error) {
      if (!abort.signal.aborted) throw error;
    } finally {
      abort.dispose();
    }
    return true;
  }
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
