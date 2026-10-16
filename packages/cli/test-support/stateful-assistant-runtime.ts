import type {
  AssistantRuntimeDefinition,
  AssistantRuntimeEvent,
  AssistantRuntimeFactory,
  AssistantRuntimeMessage,
  AssistantRuntimeResponse,
  AssistantRuntimeSession,
  AssistantRuntimeToolCall,
  AssistantToolCallDecision
} from '@inspectr/mcplab-core';
import { randomUUID } from 'node:crypto';

/** Stateful, deterministic alternative runtime for route acceptance tests. */
export function createStatefulAssistantRuntimeHarness() {
  const disposedSessions: string[] = [];
  const factory: AssistantRuntimeFactory = {
    async create(definition: AssistantRuntimeDefinition): Promise<AssistantRuntimeSession> {
      const messages: AssistantRuntimeMessage[] = structuredClone(definition.initialMessages ?? []);
      const pending: AssistantRuntimeToolCall[] = [];
      let remembered = '';
      let nextCallId = 0;
      let disposed = false;
      let revision = 0;
      let activeTurnId: string | undefined;
      const usedTurnIds = new Set<string>();
      const emit = (type: AssistantRuntimeEvent['type'], payload: Record<string, unknown> = {}) => {
        if (!disposed) definition.onEvent?.({ type, ts: new Date().toISOString(), payload });
      };
      const snapshot = () =>
        structuredClone({
          revision,
          messages,
          pendingToolCalls: pending,
          ...(activeTurnId ? { activeTurnId } : {})
        });
      const changed = () => {
        revision += 1;
      };
      const addMessage = (
        role: AssistantRuntimeMessage['role'],
        text: string,
        id = `fake-${messages.length}`
      ) => {
        messages.push({
          id,
          role,
          text,
          createdAt: new Date().toISOString()
        });
        changed();
      };
      const finish: AssistantRuntimeResponse = { type: 'assistant_message', text: '' };

      return {
        async sendMessage(
          message: string,
          _signal?: AbortSignal,
          requestedTurnId?: string
        ): Promise<AssistantRuntimeResponse> {
          if (disposed) throw new Error('Assistant session is disposed');
          const turnId = requestedTurnId ?? randomUUID();
          if (usedTurnIds.has(turnId)) {
            const error = new Error('Assistant turn ID has already been used') as Error & {
              statusCode: number;
            };
            error.statusCode = 409;
            throw error;
          }
          usedTurnIds.add(turnId);
          addMessage('user', message, turnId);
          if (nextCallId === 0) {
            activeTurnId = turnId;
            for (const name of ['first', 'second']) {
              nextCallId += 1;
              pending.push({
                id: `fake-call-${nextCallId}`,
                server: 'fake',
                tool: name,
                publicToolName: name,
                arguments: { value: `${name}-default` },
                status: 'pending',
                createdAt: new Date().toISOString()
              });
            }
            changed();
            messages.push({
              id: `fake-${messages.length}`,
              role: 'assistant',
              text: 'Two calls need decisions.',
              createdAt: new Date().toISOString(),
              pendingToolCallId: pending[0]?.id,
              pendingToolCallIds: pending.map(({ id }) => id)
            });
            changed();
            emit('turn_started');
            emit('tool_call_requested', { pendingToolCalls: pending });
            return {
              type: 'tool_call_request',
              text: 'Two calls need decisions.',
              pendingToolCalls: snapshot().pendingToolCalls
            };
          }
          const text = `Remembered ${remembered}; received ${message}`;
          addMessage('assistant', text);
          activeTurnId = undefined;
          changed();
          emit('assistant_message_completed');
          return { ...finish, text };
        },
        async resolveToolCalls(
          decisions: AssistantToolCallDecision[]
        ): Promise<AssistantRuntimeResponse> {
          if (disposed) throw new Error('Assistant session is disposed');
          for (const decision of decisions) {
            const call = pending.find(({ id }) => id === decision.toolCallId);
            if (!call || call.status !== 'pending')
              throw new Error('One or more tool calls are no longer pending');
            if (decision.arguments !== undefined)
              call.arguments = structuredClone(decision.arguments);
            call.status = decision.decision === 'approve' ? 'approved' : 'denied';
            if (decision.decision === 'approve') {
              const args =
                call.arguments && typeof call.arguments === 'object'
                  ? (call.arguments as Record<string, unknown>)
                  : {};
              remembered = String(args.value ?? 'approved');
            }
            changed();
            emit('tool_call_resolved', { pendingToolCallId: call.id, pendingToolCall: call });
          }
          const unresolved = pending.some(({ status }) => status === 'pending');
          if (unresolved) {
            return {
              type: 'tool_call_resolved',
              text: 'First decision recorded.',
              pendingToolCalls: pending.filter(({ status }) => status === 'pending')
            };
          }
          const text = `Remembered ${remembered}; second call denied.`;
          addMessage('assistant', text);
          activeTurnId = undefined;
          changed();
          emit('assistant_message_completed');
          return { ...finish, text };
        },
        async cancel(turnId: string): Promise<void> {
          if (disposed || activeTurnId !== turnId) return;
          for (const call of pending) {
            if (call.status === 'pending') call.status = 'error';
          }
          activeTurnId = undefined;
          changed();
        },
        getSnapshot: snapshot,
        dispose: async () => {
          if (disposed) return;
          disposed = true;
          disposedSessions.push(definition.assistant);
        }
      };
    }
  };
  return { factory, disposedSessions };
}
