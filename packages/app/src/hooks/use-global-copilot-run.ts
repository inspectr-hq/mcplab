import type { Interrupt, Message } from '@ag-ui/client';
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GlobalCopilotMessage, GlobalCopilotThread } from '@/lib/global-copilot-thread-store';

const runtimeAgentId = 'mcplab-global-copilot';
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function aguiMessages(messages: GlobalCopilotMessage[]): Message[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {})
  })) as Message[];
}

export function useGlobalCopilotRun({
  thread,
  renameThread,
  refresh,
  storeMessage
}: {
  thread?: GlobalCopilotThread;
  renameThread: (thread: GlobalCopilotThread, title?: string) => Promise<void>;
  refresh: (workspaceKey: string) => Promise<GlobalCopilotThread[]>;
  storeMessage: (
    message: Message,
    toolCalls: Map<string, { name: string; arguments: Record<string, unknown> }>
  ) => GlobalCopilotMessage | null;
}) {
  const fallbackThreadId = useRef(`pending-${crypto.randomUUID()}`);
  const threadId = thread?.id ?? fallbackThreadId.current;
  const { agent, isReady } = useAgent({
    agentId: `mcplab-global-copilot:${threadId}`,
    runtimeAgentId,
    threadId
  });
  const { copilotkit } = useCopilotKit();
  const [loading, setLoading] = useState(false);
  const initializedAgent = useRef<string>();

  useEffect(() => {
    if (!thread || !isReady || initializedAgent.current === thread.id) return;
    agent.setMessages(aguiMessages(thread.messages));
    initializedAgent.current = thread.id;
  }, [agent, isReady, thread]);

  const messages = useMemo(() => {
    const toolCalls = new Map<string, { name: string; arguments: Record<string, unknown> }>();
    for (const message of agent.messages) {
      if (message.role !== 'assistant') continue;
      for (const call of message.toolCalls ?? []) {
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
    return agent.messages
      .map((message) => storeMessage(message, toolCalls))
      .filter((message): message is GlobalCopilotMessage => message !== null);
  }, [agent.messages, storeMessage]);

  const send = useCallback(
    async (question: string) => {
      if (!question || !thread || !isReady || loading) return;
      const wasEmpty = agent.messages.length === 0;
      agent.addMessage({ id: id('msg'), role: 'user', content: question });
      setLoading(true);
      try {
        await copilotkit.runAgent({ agent });
        if (wasEmpty) await renameThread(thread, question.slice(0, 60));
        await refresh(thread.workspaceKey);
      } catch (error: unknown) {
        agent.addMessage({
          id: id('system'),
          role: 'system',
          content: `Copilot request failed: ${error instanceof Error ? error.message : String(error)}`
        });
      } finally {
        setLoading(false);
      }
    },
    [agent, copilotkit, isReady, loading, refresh, renameThread, thread]
  );

  const resumeStoredInterrupt = useCallback(
    async (interrupt: Interrupt, approved: boolean) => {
      if (!thread || !isReady || loading) return;
      setLoading(true);
      try {
        await copilotkit.runAgent({
          agent,
          runId: interrupt.id.split('::')[0],
          resume: [
            {
              interruptId: interrupt.id,
              status: 'resolved',
              payload: { approved }
            }
          ]
        });
        await refresh(thread.workspaceKey);
      } finally {
        setLoading(false);
      }
    },
    [agent, copilotkit, isReady, loading, refresh, thread]
  );

  return {
    agent,
    isReady,
    messages,
    loading,
    send,
    resumeStoredInterrupt,
    cancel: () => agent.abortRun()
  };
}
