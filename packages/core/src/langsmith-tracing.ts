import { Client, RunTree, type RunTreeConfig } from 'langsmith';
import type { TraceMessage, TraceMessageContentBlock } from './types.js';

type Environment = Record<string, string | undefined>;
type Values = Record<string, unknown>;

export interface LangSmithRun {
  id?: string;
  trace_id?: string;
  project_name?: string;
  client?: { getProjectUrl(options: { projectName?: string; projectId?: string }): Promise<string> };
  end(outputs?: Values, error?: string): Promise<void>;
  postRun(excludeChildRuns?: boolean): Promise<void>;
  createChild(config: RunTreeConfig): LangSmithRun;
}

export type LangSmithRunFactory = (config: RunTreeConfig) => LangSmithRun;

export interface TraceSpan {
  end(values: { outputs?: Values; error?: string }): Promise<void>;
}

export interface ScenarioTraceSpan extends TraceSpan {
  startLlm(values: { turn: number; inputs: Values }): TraceSpan;
  startTool(values: { server: string; tool: string; inputs: Values }): TraceSpan;
}

export interface TraceExporter {
  startScenario(values: Values): ScenarioTraceSpan;
  flush(): Promise<{ traceUrls: Record<string, string> }>;
}

type LangSmithMessage = Record<string, unknown>;

function toLangSmithContentBlock(block: TraceMessageContentBlock): LangSmithMessage {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return {
        type: 'tool_call',
        id: block.id,
        name: block.name,
        args: block.input
      };
    case 'image':
      return {
        type: 'image',
        base64: block.data,
        mime_type: block.media_type,
        ...(block.name ? { name: block.name } : {})
      };
    case 'document':
      return {
        type: 'file',
        base64: block.data,
        mime_type: block.media_type,
        ...(block.name ? { name: block.name } : {})
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_call_id: block.tool_use_id,
        name: block.name,
        content: block.content.map((content) => ({ type: 'text', text: content.text })),
        ...(block.is_error ? { is_error: true } : {})
      };
  }
}

/** Convert MCPLab's local trace schema to LangSmith's message schema. */
export function toLangSmithMessages(traceMessages: TraceMessage[]): LangSmithMessage[] {
  return traceMessages.flatMap((message): LangSmithMessage[] => {
    if (message.role === 'tool') {
      return message.content
        .filter((block): block is Extract<TraceMessageContentBlock, { type: 'tool_result' }> =>
          block.type === 'tool_result'
        )
        .map((block) => ({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          name: block.name,
          content: block.content.map((content) => ({ type: 'text', text: content.text }))
        }));
    }

    return [
      {
        role: message.role,
        content: message.content
          .filter((block) => block.type !== 'tool_result')
          .map(toLangSmithContentBlock)
      }
    ];
  });
}

const noopSpan: TraceSpan = { end: async () => undefined };
const noopScenarioSpan: ScenarioTraceSpan = {
  ...noopSpan,
  startLlm: () => noopSpan,
  startTool: () => noopSpan
};

function isEnabled(env: Environment): boolean {
  return env.LANGSMITH_TRACING?.trim().toLowerCase() === 'true' && Boolean(env.LANGSMITH_API_KEY);
}

function warn(error: unknown): void {
  console.warn(`LangSmith tracing warning: ${error instanceof Error ? error.message : String(error)}`);
}

function safeEnd(run: LangSmithRun, values: { outputs?: Values; error?: string }): Promise<void> {
  return Promise.resolve()
    .then(() => run.end(values.outputs, values.error))
    .catch((error) => warn(error));
}

function createRunFactory(env: Environment): LangSmithRunFactory {
  const client = new Client({
    apiKey: env.LANGSMITH_API_KEY,
    ...(env.LANGSMITH_ENDPOINT ? { apiUrl: env.LANGSMITH_ENDPOINT } : {}),
    ...(env.LANGSMITH_WORKSPACE_ID ? { workspaceId: env.LANGSMITH_WORKSPACE_ID } : {}),
    autoBatchTracing: true
  });
  return (config) => {
    const options: RunTreeConfig = {
      ...config,
      ...(env.LANGSMITH_PROJECT ? { project_name: env.LANGSMITH_PROJECT } : {}),
      client,
      tracingEnabled: true
    };
    return new RunTree(options);
  };
}

function createEnabledExporter(env: Environment, factory: LangSmithRunFactory): TraceExporter {
  const roots: LangSmithRun[] = [];
  const runsByRoot = new Map<LangSmithRun, LangSmithRun[]>();
  const requestIdsByRoot = new Map<LangSmithRun, string>();
  return {
    startScenario(values) {
      try {
        const root = factory({
          name: `MCPLab scenario: ${String(values.scenarioId ?? 'unknown')}`,
          run_type: 'chain',
          inputs: values,
          metadata: {
            ...values,
            ...(typeof values.provider === 'string' ? { ls_provider: values.provider } : {}),
            ...(typeof values.model === 'string' ? { ls_model_name: values.model } : {})
          },
          tags: ['mcplab', 'evaluation'],
          ...(env.LANGSMITH_PROJECT ? { project_name: env.LANGSMITH_PROJECT } : {}),
          serialized: { name: 'mcplab-scenario' }
        });
        roots.push(root);
        runsByRoot.set(root, [root]);
        if (typeof values.requestId === 'string' && values.requestId) {
          requestIdsByRoot.set(root, values.requestId);
        }
        return {
          startLlm({ turn, inputs }) {
            try {
              const child = root.createChild({
                name: `LLM turn ${turn}`,
                run_type: 'llm',
                inputs,
                serialized: { name: 'mcplab-llm' }
              });
              runsByRoot.get(root)?.push(child);
              return spanFromRun(child);
            } catch (error) {
              warn(error);
              return noopSpan;
            }
          },
          startTool({ server, tool, inputs }) {
            try {
              const child = root.createChild({
                name: tool,
                run_type: 'tool',
                inputs,
                metadata: { server, tool },
                serialized: { name: 'mcplab-mcp-tool' }
              });
              runsByRoot.get(root)?.push(child);
              return spanFromRun(child);
            } catch (error) {
              warn(error);
              return noopSpan;
            }
          },
          end: (result) => safeEnd(root, result)
        };
      } catch (error) {
        warn(error);
        return noopScenarioSpan;
      }
    },
    async flush() {
      const traceUrls: Record<string, string> = {};
      for (const root of roots.splice(0)) {
        try {
          const runs = runsByRoot.get(root) ?? [root];
          for (const run of runs.slice(1)) await run.postRun();
          await root.postRun();
          const requestId = requestIdsByRoot.get(root);
          if (requestId && root.id && root.client) {
            const projectUrl = await root.client.getProjectUrl({
              projectName: root.project_name
            });
            traceUrls[requestId] = `${projectUrl}/r/${root.id}?poll=true`;
          }
          runsByRoot.delete(root);
          requestIdsByRoot.delete(root);
        } catch (error) {
          warn(error);
        }
      }
      return { traceUrls };
    }
  };
}

function spanFromRun(run: LangSmithRun): TraceSpan {
  return { end: (values) => safeEnd(run, values) };
}

export function createLangSmithTraceExporter(
  env: Environment = process.env,
  factory?: LangSmithRunFactory
): TraceExporter {
  if (!isEnabled(env)) {
    return { startScenario: () => noopScenarioSpan, flush: async () => ({ traceUrls: {} }) };
  }
  return createEnabledExporter(env, factory ?? createRunFactory(env));
}
