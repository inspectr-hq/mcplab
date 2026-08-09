import type { ReactNode } from 'react';
import { useInterrupt } from '@copilotkit/react-core/v2';
import {
  NativeInterruptCard,
  globalCopilotInterruptMessage,
  globalCopilotInterruptMessageFromMastra
} from './GlobalCopilotCards';

export function useGlobalCopilotInterrupts({
  agentId,
  storedInterrupt,
  resumeStoredInterrupt
}: {
  agentId?: string;
  storedInterrupt?: { id: string; metadata?: Record<string, any> };
  resumeStoredInterrupt: (
    interrupt: { id: string; metadata?: Record<string, any> },
    approved: boolean
  ) => Promise<void>;
}): ReactNode {
  const interruptElement = useInterrupt({
    agentId,
    renderInChat: false,
    enabled: (event) =>
      (event.value as { reason?: string } | undefined)?.reason === 'mastra:tool_suspend',
    render: ({ interrupt, resolve }) => {
      const mastra = interrupt?.metadata?.mastra as
        | {
            toolName?: string;
            suspendPayload?: Record<string, unknown>;
            args?: Record<string, unknown>;
          }
        | undefined;
      const message = globalCopilotInterruptMessageFromMastra(
        interrupt?.id ?? 'pending-tool-approval',
        mastra
      );
      return (
        <NativeInterruptCard
          message={message}
          onDecision={(approved) => void resolve({ approved }, interrupt?.id)}
        />
      );
    }
  });
  if (interruptElement) return interruptElement;
  if (!storedInterrupt) return null;
  return (
    <NativeInterruptCard
      message={globalCopilotInterruptMessage(storedInterrupt)}
      onDecision={(approved) => void resumeStoredInterrupt(storedInterrupt, approved)}
    />
  );
}
