import { Button } from '@/components/ui/button';
import { AssistantToolCallCard } from '@/components/assistant/AssistantChat';
import type { GlobalCopilotMessage } from '@/lib/global-copilot-thread-store';

export function GlobalCopilotActionCard({
  message,
  onContinue,
  onOpenResult,
  onRunEvaluation,
  onWriteReport,
  onExternalTool,
  onStartAction,
  onLibraryAction
}: {
  message: GlobalCopilotMessage;
  onContinue: (message: GlobalCopilotMessage, approved: boolean) => void;
  onOpenResult: (message: GlobalCopilotMessage) => void;
  onRunEvaluation: (message: GlobalCopilotMessage, approved: boolean) => void;
  onWriteReport: (message: GlobalCopilotMessage, approved: boolean) => void;
  onExternalTool: (message: GlobalCopilotMessage, approved: boolean) => void;
  onStartAction: (message: GlobalCopilotMessage, approved: boolean) => void;
  onLibraryAction: (message: GlobalCopilotMessage, approved: boolean) => void;
}) {
  const action = message.action;
  if (!action) return null;
  if (action.kind === 'continue_reading' && action.status === 'pending')
    return (
      <div className="rounded-md border border-amber-400/40 bg-amber-50 p-2 text-sm">
        <p>
          Allow up to {action.batchSize} additional read-only MCPLab tool calls to continue this
          investigation?
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => onContinue(message, true)}>
            Continue
          </Button>
          <Button size="sm" variant="outline" onClick={() => onContinue(message, false)}>
            Stop here
          </Button>
        </div>
      </div>
    );
  if (action.kind === 'open_result_detail' && action.status === 'pending')
    return (
      <div className="rounded-md border border-sky-500/30 bg-sky-500/10 p-2 text-sm">
        <p>Result Detail available for run {action.runId}.</p>
        <div className="mt-2">
          <Button size="sm" onClick={() => onOpenResult(message)}>
            Open Result Detail
          </Button>
        </div>
      </div>
    );
  if (action.kind === 'open_test_case' && action.status === 'approved')
    return <p className="text-xs text-emerald-700">Opened Test Case {action.testCaseId}.</p>;
  if (action.kind === 'navigate_to_result_detail' && action.status === 'approved')
    return <p className="text-xs text-emerald-700">Opened Result Detail {action.runId}.</p>;
  if (action.kind === 'run_mcp_evaluation')
    return (
      <AssistantToolCallCard
        call={{
          id: message.id,
          server: 'mcplab',
          tool: 'Run Evaluation',
          publicToolName: 'mcplab_run_eval',
          arguments: action.arguments,
          status: action.status,
          createdAt: message.createdAt
        }}
        description="This runs an evaluation with the displayed temporary overrides."
        onApprove={() => onRunEvaluation(message, true)}
        onDeny={() => onRunEvaluation(message, false)}
      />
    );
  if (action.kind === 'write_markdown_report')
    return (
      <AssistantToolCallCard
        call={{
          id: message.id,
          server: 'mcplab',
          tool: 'Write Markdown Report',
          publicToolName: 'mcplab_write_markdown_report',
          arguments: action.arguments,
          status: action.status,
          createdAt: message.createdAt
        }}
        description="This writes the displayed Markdown report inside the current workspace."
        onApprove={() => onWriteReport(message, true)}
        onDeny={() => onWriteReport(message, false)}
      />
    );
  if (action.kind === 'external_mcp_tool')
    return (
      <AssistantToolCallCard
        call={{
          id: message.id,
          server: action.serverName,
          tool: action.toolName,
          publicToolName: `${action.serverName}__${action.toolName}`,
          arguments: action.arguments,
          status: action.status,
          createdAt: message.createdAt
        }}
        description={`External MCP call on ${action.serverName}.`}
        onApprove={() => onExternalTool(message, true)}
        onDeny={() => onExternalTool(message, false)}
      />
    );
  if (action.kind === 'start_action' && action.status === 'pending')
    return (
      <div className="rounded-md border border-amber-400/40 bg-amber-50 p-2 text-sm">
        <p>
          Start {action.name === 'start_evaluation_run' ? 'the evaluation run' : 'Tool Analysis'}{' '}
          using the current page settings?
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={() => onStartAction(message, true)}>
            Start
          </Button>
          <Button size="sm" variant="outline" onClick={() => onStartAction(message, false)}>
            Not now
          </Button>
        </div>
      </div>
    );
  if (action.kind === 'library_action')
    return (
      <AssistantToolCallCard
        call={{
          id: message.id,
          server: 'mcplab',
          tool:
            action.name === 'duplicate_test_case'
              ? 'Duplicate Test Case'
              : action.name === 'duplicate_mcp_server'
                ? 'Duplicate MCP Server'
                : 'Duplicate Agent',
          publicToolName: action.name,
          arguments: action.arguments,
          status: action.status,
          createdAt: message.createdAt
        }}
        description="This creates a copy using the same library-page action as the Duplicate button."
        onApprove={() => onLibraryAction(message, true)}
        onDeny={() => onLibraryAction(message, false)}
      />
    );
  if (action.kind === 'navigate_to_view' && action.status === 'approved')
    return <p className="text-xs text-emerald-700">Opened {action.path}</p>;
  if (action.status === 'denied')
    return <p className="text-xs text-muted-foreground">Action declined</p>;
  if (action.status === 'error') return <p className="text-xs text-destructive">Action failed</p>;
  return null;
}
