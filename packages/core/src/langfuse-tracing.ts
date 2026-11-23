import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseClient } from '@langfuse/client';
import { trace, ROOT_CONTEXT } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import type { ScenarioTraceSpan, TraceExporter, TraceSpan } from './langsmith-tracing.js';

type Values = Record<string, unknown>;
type Environment = Record<string, string | undefined>;
const noop: TraceSpan = { end: async () => undefined };
const noopScenario: ScenarioTraceSpan = { ...noop, startLlm: () => noop, startTool: () => noop };

export function isLangfuseEnabled(env: Environment = process.env): boolean {
  return (
    env.LANGFUSE_TRACING?.trim().toLowerCase() === 'true' &&
    Boolean(env.LANGFUSE_PUBLIC_KEY?.trim()) &&
    Boolean(env.LANGFUSE_SECRET_KEY?.trim())
  );
}

export function createLangfuseTraceExporter(env: Environment = process.env): TraceExporter {
  if (!isLangfuseEnabled(env))
    return { startScenario: () => noopScenario, flush: async () => ({ traceUrls: {} }) };
  try {
    return createEnabledExporter(env);
  } catch (error) {
    warn(error);
    return { startScenario: () => noopScenario, flush: async () => ({ traceUrls: {} }) };
  }
}

function warn(error: unknown): void {
  console.warn(`Langfuse tracing warning: ${String(error)}`);
}

function createEnabledExporter(env: Environment): TraceExporter {
  const baseUrl = (env.LANGFUSE_BASE_URL?.trim() || 'https://cloud.langfuse.com').replace(
    /\/+$/,
    ''
  );
  const processor = new LangfuseSpanProcessor({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl,
    shouldExportSpan: () => true
  });
  const client = new LangfuseClient({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl
  });
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  const tracer = provider.getTracer('mcplab');
  const pending: Array<{ requestId: string; traceId: string }> = [];
  const span = (otel: ReturnType<typeof tracer.startSpan>, generation = false): TraceSpan => ({
    async end(values) {
      if (values.outputs !== undefined)
        otel.setAttribute('langfuse.observation.output', JSON.stringify(values.outputs));
      const usage = values.outputs?.usage_metadata;
      if (generation && usage && typeof usage === 'object') {
        const counts = usage as Record<string, unknown>;
        const details = Object.fromEntries(
          [
            ['input', counts.input_tokens],
            ['output', counts.output_tokens],
            ['total', counts.total_tokens]
          ].filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
        );
        if (Object.keys(details).length)
          otel.setAttribute('langfuse.observation.usage_details', JSON.stringify(details));
      }
      if (values.error) {
        otel.setAttribute('langfuse.observation.level', 'ERROR');
        otel.setAttribute('langfuse.observation.status_message', values.error);
        otel.setStatus({ code: 2, message: values.error });
      }
      otel.end();
    }
  });
  return {
    startScenario(values) {
      const root = tracer.startSpan(`MCPLab scenario: ${String(values.scenarioId ?? 'unknown')}`, {
        root: true
      });
      root.setAttribute('langfuse.observation.type', 'chain');
      root.setAttribute(
        'langfuse.trace.name',
        `MCPLab scenario: ${String(values.scenarioId ?? 'unknown')}`
      );
      root.setAttribute('langfuse.trace.tags', ['mcplab', 'evaluation']);
      root.setAttribute('langfuse.observation.input', JSON.stringify(values));
      root.setAttribute(
        'langfuse.trace.metadata.scenario_id',
        String(values.scenarioId ?? 'unknown')
      );
      const context = trace.setSpan(ROOT_CONTEXT, root);
      if (typeof values.requestId === 'string')
        pending.push({ requestId: values.requestId, traceId: root.spanContext().traceId });
      return {
        startLlm({ turn, inputs, metadata }) {
          const child = tracer.startSpan(
            `LLM turn ${turn}`,
            {
              attributes: {
                'langfuse.observation.type': 'generation',
                'langfuse.observation.input': JSON.stringify(inputs),
                'langfuse.observation.model.name': String(metadata?.model ?? values.model ?? ''),
                'langfuse.observation.metadata.provider': String(
                  metadata?.provider ?? values.provider ?? ''
                )
              }
            },
            context
          );
          return span(child, true);
        },
        startTool({ server, tool, inputs }) {
          const child = tracer.startSpan(
            tool,
            {
              attributes: {
                'langfuse.observation.type': 'tool',
                'langfuse.observation.input': JSON.stringify(inputs),
                'langfuse.observation.metadata.server': server
              }
            },
            context
          );
          return span(child);
        },
        end: (values) => span(root).end(values)
      };
    },
    async flush() {
      try {
        await provider.forceFlush();
      } catch (error) {
        warn(error);
      }
      try {
        await provider.shutdown();
      } catch (error) {
        warn(error);
      }
      const langfuseTraceUrls: Record<string, string> = {};
      if (pending.length) {
        try {
          // Resolve once with an explicit request deadline, including retries.
          const projects = await client.api.projects.get(
            {},
            {
              timeoutInSeconds: 5,
              maxRetries: 0,
              abortSignal: AbortSignal.timeout(5000)
            }
          );
          const projectId = projects.data[0]?.id;
          if (!projectId) throw new Error('No Langfuse project found');
          for (const { requestId, traceId } of pending.splice(0)) {
            langfuseTraceUrls[requestId] =
              `${baseUrl}/project/${encodeURIComponent(projectId)}/traces/${traceId}`;
          }
        } catch (error) {
          pending.length = 0;
          warn(error);
        }
      }
      try {
        await client.shutdown();
      } catch (error) {
        warn(error);
      }
      return { traceUrls: {}, langfuseTraceUrls };
    }
  };
}
