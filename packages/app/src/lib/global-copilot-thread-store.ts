import type { Interrupt } from '@ag-ui/client';

export type GlobalCopilotMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  createdAt: string;
  toolCallId?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  action?:
    | {
        kind: 'navigate_to_view';
        path: string;
        reason?: string;
        status: 'pending' | 'approved' | 'denied';
      }
    | {
        kind: 'external_mcp_tool';
        serverName: string;
        toolName: string;
        arguments: Record<string, unknown>;
        status: 'pending' | 'approved' | 'denied' | 'error';
      }
    | {
        kind: 'start_action';
        name: 'start_evaluation_run' | 'queue_evaluation_run' | 'start_tool_analysis';
        arguments?: Record<string, unknown>;
        status: 'pending' | 'approved' | 'denied' | 'error';
      }
    | {
        kind: 'library_action';
        name:
          | 'duplicate_test_case'
          | 'duplicate_mcp_server'
          | 'duplicate_agent'
          | 'create_test_case';
        arguments: Record<string, unknown>;
        status: 'pending' | 'approved' | 'denied' | 'error';
      }
    | {
        kind: 'continue_reading';
        batchSize: number;
        status: 'pending' | 'approved' | 'denied';
      }
    | {
        kind: 'open_result_detail';
        runId: string;
        status: 'pending' | 'approved';
      }
    | {
        kind: 'open_test_case';
        testCaseId: string;
        status: 'pending' | 'approved' | 'error';
      }
    | {
        kind: 'navigate_to_result_detail';
        runId: string;
        status: 'pending' | 'approved';
      }
    | {
        kind: 'run_mcp_evaluation';
        arguments: Record<string, unknown>;
        status: 'pending' | 'approved' | 'denied' | 'error';
      }
    | {
        kind: 'write_markdown_report';
        arguments: Record<string, unknown>;
        status: 'pending' | 'approved' | 'denied' | 'error';
      }
    | {
        kind: 'create_evaluation_config';
        arguments: Record<string, unknown>;
        status: 'pending' | 'approved' | 'denied' | 'error';
      };
};

export type GlobalCopilotThread = {
  version: 1;
  id: string;
  workspaceKey: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: GlobalCopilotMessage[];
  pendingInterrupts?: Interrupt[];
};

export async function workspaceKeyFromRoot(workspaceRoot: string): Promise<string> {
  const bytes = new TextEncoder().encode(workspaceRoot);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}
