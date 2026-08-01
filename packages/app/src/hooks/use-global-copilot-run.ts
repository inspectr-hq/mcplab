import { HttpAgent, type Message } from '@ag-ui/client';
import { useCallback, useRef, useState } from 'react';
import { availableGlobalCopilotActions } from '@/lib/global-copilot-actions';
import { globalCopilotRouteContext } from '@/lib/global-copilot-context';
import type { GlobalCopilotMessage, GlobalCopilotThread } from '@/lib/global-copilot-thread-store';

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function useGlobalCopilotRun({
  version,
  queue,
  pathname,
  search,
  workspaceKey,
  thread,
  save,
  storeMessage
}: {
  version?: string;
  queue: {
    runningCount: number;
    queuedCount: number;
    oauthBlockedCount: number;
    streamStatus: string;
  };
  pathname: string;
  search: string;
  workspaceKey?: string;
  thread?: GlobalCopilotThread;
  save: (thread: GlobalCopilotThread) => Promise<GlobalCopilotThread>;
  storeMessage: (
    message: Message,
    toolCalls: Map<string, { name: string; arguments: Record<string, unknown> }>
  ) => GlobalCopilotMessage | null;
}) {
  const [loading, setLoading] = useState(false);
  const agentRef = useRef<HttpAgent>();
  const send = useCallback(
    async (
      question: string,
      continuation?: GlobalCopilotMessage,
      continuationThread?: GlobalCopilotThread
    ) => {
      if (!question || !workspaceKey || loading) return;
      const now = new Date().toISOString();
      const active =
        continuationThread ??
        thread ??
        ({
          id: id('gct'),
          workspaceKey,
          title: question.slice(0, 60),
          messages: [],
          createdAt: now,
          updatedAt: now,
          version: 1
        } satisfies GlobalCopilotThread);
      const submitted =
        continuation ??
        ({
          id: id('msg'),
          role: 'user',
          content: question,
          createdAt: now
        } satisfies GlobalCopilotMessage);
      const optimistic = await save({
        ...active,
        title: active.messages.length || continuation ? active.title : question.slice(0, 60),
        messages: [...active.messages, submitted]
      });
      setLoading(true);
      try {
        const agent = new HttpAgent({
          url: '/api/global-copilot/run',
          agentId: 'mcplab-global-copilot',
          threadId: optimistic.id,
          initialMessages: optimistic.messages.map((message) =>
            message.role === 'tool'
              ? {
                  id: message.id,
                  role: 'system' as const,
                  content: `Previously retrieved tool data:\n${message.content}`
                }
              : {
                  id: message.id,
                  role: message.role,
                  content: message.content,
                  ...(message.toolCallId ? { toolCallId: message.toolCallId } : {})
                }
          )
        });
        agentRef.current = agent;
        await agent.runAgent({
          forwardedProps: {
            context: {
              ...globalCopilotRouteContext(pathname, search),
              mcplabVersion: version,
              queue,
              availableActions: availableGlobalCopilotActions()
            }
          }
        });
        const toolCalls = new Map<string, { name: string; arguments: Record<string, unknown> }>();
        for (const message of agent.messages) {
          if (message.role !== 'assistant') continue;
          for (const call of (
            message as Message & {
              toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>;
            }
          ).toolCalls ?? []) {
            try {
              toolCalls.set(call.id, {
                name: call.function.name,
                arguments: JSON.parse(call.function.arguments) as Record<string, unknown>
              });
            } catch {
              toolCalls.set(call.id, { name: call.function.name, arguments: {} });
            }
          }
        }
        const messages = agent.messages
          .map((message) => storeMessage(message, toolCalls))
          .filter((message): message is GlobalCopilotMessage => message !== null);
        await save({ ...optimistic, messages });
      } catch (error: unknown) {
        const text = error instanceof Error ? error.message : String(error);
        await save({
          ...optimistic,
          messages: [
            ...optimistic.messages,
            {
              id: id('system'),
              role: 'system',
              content: `Copilot request failed: ${text}`,
              createdAt: new Date().toISOString()
            }
          ]
        });
      } finally {
        agentRef.current = undefined;
        setLoading(false);
      }
    },
    [loading, pathname, queue, save, search, storeMessage, thread, version, workspaceKey]
  );

  return { loading, send, cancel: () => agentRef.current?.abortRun() };
}
