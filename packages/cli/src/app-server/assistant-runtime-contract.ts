import type {
  AssistantKind,
  AssistantRuntimeEvent,
  AssistantRuntimeMessage,
  AssistantRuntimeResponse,
  AssistantRuntimeSnapshot,
  AssistantToolCallDecision,
  LlmAgentConfig,
  ResultAssistantRuntimeContext,
  ScenarioAssistantRuntimeContext,
  ScenarioAssistantSuggestionBundle
} from '@inspectr/mcplab-core';

/**
 * The server-side assistant runtime boundary. Only the CLI implements and consumes it; the
 * browser-facing transport types (snapshots, events, decisions) stay in core.
 */
export interface AssistantRuntimeDefinition {
  assistant: AssistantKind;
  agent: LlmAgentConfig;
  context: ScenarioAssistantRuntimeContext | ResultAssistantRuntimeContext;
  getSystemPrompt(): string;
  tools: AssistantRuntimeTool[];
  initialMessages?: AssistantRuntimeMessage[];
  approvalPolicy(toolName: string): 'automatic' | 'approval_required' | 'local';
  onEvent?(event: AssistantRuntimeEvent): void;
  dispose?(): Promise<void> | void;
}

export interface AssistantRuntimeTool {
  name: string;
  server: string;
  tool: string;
  description?: string;
  inputSchema?: unknown;
  execute(arguments_: unknown, signal?: AbortSignal): Promise<unknown>;
  extractProposal?(result: unknown): ScenarioAssistantSuggestionBundle | undefined;
}

export interface AssistantRuntimeSession {
  /** A supplied turnId also identifies the user message. Reusing an accepted ID is a conflict. */
  sendMessage(
    message: string,
    signal?: AbortSignal,
    turnId?: string
  ): Promise<AssistantRuntimeResponse>;
  resolveToolCalls(
    decisions: AssistantToolCallDecision[],
    signal?: AbortSignal
  ): Promise<AssistantRuntimeResponse>;
  getSnapshot(): AssistantRuntimeSnapshot;
  /** Idempotent for completed or unknown IDs, and never cancels a different in-flight turn. */
  cancel(turnId: string): Promise<void>;
  isBusy?(): boolean;
  dispose(): Promise<void> | void;
}

export interface AssistantRuntimeFactory {
  create(definition: AssistantRuntimeDefinition): Promise<AssistantRuntimeSession>;
}
