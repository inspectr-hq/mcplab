import { Client } from 'langsmith';
import { RunTree } from 'langsmith/run_trees';
import { withRunTree } from 'langsmith/traceable';

/** Assistant traces are private unless the user opts in, even when evaluation tracing is on. */
export function isAssistantTracingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MCPLAB_ASSISTANT_TRACING?.trim().toLowerCase() === 'true';
}

export function withAssistantTracing<T>(operation: () => Promise<T>): Promise<T> {
  return isAssistantTracingEnabled() ? operation() : withAssistantTraceExportDisabled(operation);
}

export function withAssistantTraceExportDisabled<T>(operation: () => Promise<T>): Promise<T> {
  // LangGraph needs an enabled trace context to propagate a client through callbacks. Seed its
  // per-operation client before children start so zero sampling rejects the entire trace; the
  // local discard transport also fails closed if future LangSmith behavior bypasses sampling.
  const client = new Client({
    apiUrl: 'https://assistant-tracing.disabled.invalid',
    apiKey: 'disabled',
    tracingSamplingRate: 0,
    tracingMode: 'langsmith',
    fetchImplementation: async () => new Response('{}', { status: 200 })
  });
  const runTree = new RunTree({
    name: 'MCPLab Assistant',
    run_type: 'chain',
    tracingEnabled: true,
    client
  });
  return runTree.postRun().then(() => withRunTree(runTree, operation));
}
