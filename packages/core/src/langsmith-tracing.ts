import { Client, RunTree, type RunTreeConfig } from 'langsmith';

type Environment = Record<string, string | undefined>;
type Values = Record<string, unknown>;

export interface LangSmithRun {
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
  flush(): Promise<void>;
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
  return {
    startScenario(values) {
      try {
        const root = factory({
          name: `MCPLab scenario: ${String(values.scenarioId ?? 'unknown')}`,
          run_type: 'chain',
          inputs: values,
          metadata: values,
          tags: ['mcplab', 'evaluation'],
          ...(env.LANGSMITH_PROJECT ? { project_name: env.LANGSMITH_PROJECT } : {}),
          serialized: { name: 'mcplab-scenario' }
        });
        roots.push(root);
        return {
          startLlm({ turn, inputs }) {
            try {
              return spanFromRun(root.createChild({
                name: `LLM turn ${turn}`,
                run_type: 'llm',
                inputs,
                serialized: { name: 'mcplab-llm' }
              }));
            } catch (error) {
              warn(error);
              return noopSpan;
            }
          },
          startTool({ server, tool, inputs }) {
            try {
              return spanFromRun(root.createChild({
                name: `MCP tool: ${server}/${tool}`,
                run_type: 'tool',
                inputs,
                serialized: { name: 'mcplab-mcp-tool' }
              }));
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
      for (const root of roots.splice(0)) {
        try {
          await root.postRun();
        } catch (error) {
          warn(error);
        }
      }
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
    return { startScenario: () => noopScenarioSpan, flush: async () => undefined };
  }
  return createEnabledExporter(env, factory ?? createRunFactory(env));
}
