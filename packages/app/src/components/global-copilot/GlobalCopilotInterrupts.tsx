import type { ReactNode } from 'react';
import { useInterrupt } from '@copilotkit/react-core/v2';
import { NativeInterruptCard, globalCopilotInterruptMessage } from './GlobalCopilotCards';
import type { GlobalCopilotMessage } from '@/lib/global-copilot-thread-store';

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
      const payload = mastra?.suspendPayload ?? {};
      const message: GlobalCopilotMessage =
        payload.kind === 'continue_reading'
          ? {
              id: interrupt?.id ?? 'pending-read-approval',
              role: 'system',
              content: `Additional MCPLab read-tool batch requested (${Number(
                payload.batchSize ?? 5
              )} calls).`,
              createdAt: new Date().toISOString(),
              action: {
                kind: 'continue_reading',
                batchSize: Number(payload.batchSize ?? 5),
                status: 'pending'
              }
            }
          : {
              id: interrupt?.id ?? 'pending-tool-approval',
              role: 'system',
              content: `MCP call requested: ${String(payload.serverName ?? 'mcplab')}/${String(
                payload.toolName ?? mastra?.toolName ?? 'tool'
              )}`,
              createdAt: new Date().toISOString(),
              action: {
                kind: 'external_mcp_tool',
                serverName: String(payload.serverName ?? 'mcplab'),
                toolName: String(payload.toolName ?? mastra?.toolName ?? 'tool'),
                arguments: (payload.arguments ?? mastra?.args ?? {}) as Record<string, unknown>,
                status: 'pending'
              }
            };
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
