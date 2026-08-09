export type GlobalCopilotActionName =
  | 'start_evaluation_run'
  | 'queue_evaluation_run'
  | 'queue_evaluation_by_config'
  | 'apply_scenario_patch'
  | 'preview_scenario'
  | 'send_copilot_message'
  | 'start_tool_analysis'
  | 'duplicate_test_case'
  | 'create_test_case'
  | 'duplicate_mcp_server'
  | 'duplicate_agent';

type RegisteredAction = (arguments_: Record<string, unknown>) => Promise<unknown> | unknown;

const actions = new Map<GlobalCopilotActionName, RegisteredAction>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function registerGlobalCopilotAction(
  name: GlobalCopilotActionName,
  action: RegisteredAction
): () => void {
  actions.set(name, action);
  notify();
  return () => {
    if (actions.get(name) === action) {
      actions.delete(name);
      notify();
    }
  };
}

export function subscribeGlobalCopilotActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function availableGlobalCopilotActions(): GlobalCopilotActionName[] {
  return [...actions.keys()];
}

export async function invokeGlobalCopilotAction(
  name: GlobalCopilotActionName,
  arguments_: Record<string, unknown> = {}
): Promise<unknown> {
  const action = actions.get(name);
  if (!action) throw new Error('This action is no longer available on the current page.');
  return action(arguments_);
}
