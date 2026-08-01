export type GlobalCopilotActionName = 'start_evaluation_run' | 'start_tool_analysis';

type RegisteredAction = () => Promise<void> | void;

const actions = new Map<GlobalCopilotActionName, RegisteredAction>();

export function registerGlobalCopilotAction(name: GlobalCopilotActionName, action: RegisteredAction): () => void {
  actions.set(name, action);
  return () => {
    if (actions.get(name) === action) actions.delete(name);
  };
}

export function availableGlobalCopilotActions(): GlobalCopilotActionName[] {
  return [...actions.keys()];
}

export async function invokeGlobalCopilotAction(name: GlobalCopilotActionName): Promise<void> {
  const action = actions.get(name);
  if (!action) throw new Error('This action is no longer available on the current page.');
  await action();
}
