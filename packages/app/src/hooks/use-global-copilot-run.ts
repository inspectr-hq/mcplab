import type { Interrupt, Message } from '@ag-ui/client';
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GlobalCopilotMessage, GlobalCopilotThread } from '@/lib/global-copilot-thread-store';

const runtimeAgentId = 'mcplab-global-copilot';
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function globalCopilotRunIdFromInterruptId(interruptId: string): string {
  const separator = interruptId.indexOf('::');
  return separator > 0 ? interruptId.slice(0, separator) : interruptId;
}

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
    agentId: runtimeAgentId,
    runtimeAgentId,
    threadId
  });
  const { copilotkit } = useCopilotKit();
  const [loading, setLoading] = useState(false);
  const initializedAgent = useRef<string>();
  const runGeneration = useRef(0);
  const activeThreadIdRef = useRef<string>();

  useEffect(() => {
    activeThreadIdRef.current = thread?.id;
    runGeneration.current += 1;
    setLoading(false);
  }, [thread?.id]);

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
      if (
        !question ||
        !thread ||
        !isReady ||
        loading ||
        (thread.pendingInterrupts?.length ?? 0) > 0
      )
        return;
      const activeThreadId = thread.id;
      const generation = runGeneration.current;
      const isCurrentRun = () =>
        runGeneration.current === generation && activeThreadIdRef.current === activeThreadId;
      const wasEmpty = agent.messages.length === 0;
      agent.addMessage({ id: id('msg'), role: 'user', content: question });
      setLoading(true);
      try {
        await copilotkit.runAgent({ agent });
        if (!isCurrentRun()) return;
        if (wasEmpty) await renameThread(thread, question.slice(0, 60));
        if (isCurrentRun()) await refresh(thread.workspaceKey);
      } catch (error: unknown) {
        if (!isCurrentRun()) return;
        agent.addMessage({
          id: id('system'),
          role: 'system',
          content: `Copilot request failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        });
      } finally {
        if (isCurrentRun()) setLoading(false);
      }
    },
    [agent, copilotkit, isReady, loading, refresh, renameThread, thread]
  );

  const resumeStoredInterrupt = useCallback(
    async (interrupt: Interrupt, approved: boolean) => {
      if (!thread || !isReady || loading) return;
      const activeThreadId = thread.id;
      const generation = runGeneration.current;
      const isCurrentRun = () =>
        runGeneration.current === generation && activeThreadIdRef.current === activeThreadId;
      setLoading(true);
      try {
        await copilotkit.runAgent({
          agent,
          runId: globalCopilotRunIdFromInterruptId(interrupt.id),
          resume: [
            {
              interruptId: interrupt.id,
              status: 'resolved',
              payload: { approved }
            }
          ]
        });
        if (isCurrentRun()) await refresh(thread.workspaceKey);
      } finally {
        if (isCurrentRun()) setLoading(false);
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
