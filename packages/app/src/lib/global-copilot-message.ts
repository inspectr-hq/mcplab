import type { Message } from '@ag-ui/client';
import type { GlobalCopilotMessage } from './global-copilot-thread-store';

const actionMarker = '[mcplab-action]';

export function globalCopilotToolDisplayName(name: string): string {
  return name.replace(/^mcplab__(?=mcplab_)/, '').replace(/^mcplab_mcplab_/, 'mcplab_');
}

export function globalCopilotToolLabel(name: string): string {
  const toolName = globalCopilotToolDisplayName(name);
  const words = toolName
    .replace(/^mcplab_/, '')
    .split('_')
    .filter(Boolean);
  return words.length
    ? words.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join(' ')
    : toolName;
}

export function storedGlobalCopilotFrontendAction(message: Message): GlobalCopilotMessage | null {
  if (message.role !== 'assistant' || !message.content?.startsWith(actionMarker)) return null;
  try {
    const action = JSON.parse(message.content.slice(actionMarker.length)) as Record<
      string,
      unknown
    >;
    const createdAt = new Date().toISOString();
    if (action.kind === 'navigate_to_view' && typeof action.path === 'string') {
      return {
        id: message.id,
        role: 'system',
        content: `Opening ${action.path}.`,
        createdAt,
        action: {
          kind: 'navigate_to_view',
          path: action.path,
          reason: typeof action.reason === 'string' ? action.reason : undefined,
          status: 'pending'
        }
      };
    }
    if (
      action.kind === 'start_action' &&
      (action.name === 'start_evaluation_run' || action.name === 'start_tool_analysis')
    ) {
      return {
        id: message.id,
        role: 'system',
        content: 'Run action requested.',
        createdAt,
        action: { kind: 'start_action', name: action.name, status: 'pending' }
      };
    }
    if (
      action.kind === 'external_mcp_tool' &&
      typeof action.serverName === 'string' &&
      typeof action.toolName === 'string' &&
      action.arguments &&
      typeof action.arguments === 'object'
    ) {
      return {
        id: message.id,
        role: 'system',
        content: `External MCP call requested: ${action.serverName}/${action.toolName}`,
        createdAt,
        action: {
          kind: 'external_mcp_tool',
          serverName: action.serverName,
          toolName: action.toolName,
          arguments: action.arguments as Record<string, unknown>,
          status: 'pending'
        }
      };
    }
    if (
      (action.kind === 'run_mcp_evaluation' || action.kind === 'write_markdown_report') &&
      action.arguments &&
      typeof action.arguments === 'object'
    ) {
      return {
        id: message.id,
        role: 'system',
        content:
          action.kind === 'run_mcp_evaluation'
            ? 'MCPLab evaluation run requested.'
            : 'Markdown report write requested.',
        createdAt,
        action: {
          kind: action.kind,
          arguments: action.arguments as Record<string, unknown>,
          status: 'pending'
        }
      } as GlobalCopilotMessage;
    }
    if (action.kind === 'continue_reading' && typeof action.batchSize === 'number') {
      return {
        id: message.id,
        role: 'system',
        content: `Additional MCPLab read-tool batch requested (${action.batchSize} calls).`,
        createdAt,
        action: { kind: 'continue_reading', batchSize: action.batchSize, status: 'pending' }
      };
    }
    if (action.kind === 'open_result_detail' && typeof action.runId === 'string') {
      return {
        id: message.id,
        role: 'system',
        content: `Result Detail available for run ${action.runId}.`,
        createdAt,
        action: { kind: 'open_result_detail', runId: action.runId, status: 'pending' }
      };
    }
  } catch {
    // Invalid action payloads are rendered as normal assistant messages.
  }
  return null;
}
