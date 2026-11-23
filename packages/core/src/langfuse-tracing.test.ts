import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

const sdk = vi.hoisted(() => ({
  spans: [] as ReadableSpan[],
  initialize: vi.fn(),
  projects: vi.fn(),
  shutdown: vi.fn()
}));
vi.mock('@langfuse/otel', () => ({
  LangfuseSpanProcessor: class {
    constructor() {
      sdk.initialize();
    }
    onStart() {}
    onEnd(span: ReadableSpan) {
      sdk.spans.push(span);
    }
    forceFlush = async () => undefined;
    shutdown = async () => undefined;
  }
}));
vi.mock('@langfuse/client', () => ({
  LangfuseClient: class {
    api = { projects: { get: sdk.projects } };
    shutdown = sdk.shutdown;
  }
}));
import { createLangfuseTraceExporter } from './langfuse-tracing.js';

const env = {
  LANGFUSE_TRACING: 'true',
  LANGFUSE_PUBLIC_KEY: 'public',
  LANGFUSE_SECRET_KEY: 'secret',
  LANGFUSE_BASE_URL: 'https://self-hosted.test/'
};
beforeEach(() => {
  vi.resetAllMocks();
  sdk.spans.length = 0;
  sdk.projects.mockResolvedValue({ data: [{ id: 'project-1' }] });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('Langfuse tracing', () => {
  it('falls back to a no-op when SDK initialization throws', async () => {
    sdk.initialize.mockImplementation(() => {
      throw new Error('invalid endpoint');
    });
    const exporter = createLangfuseTraceExporter(env);
    await exporter.startScenario({}).end({});
    expect(await exporter.flush()).toEqual({ traceUrls: {} });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('invalid endpoint'));
  });

  it.each([false, true])(
    'resolves the project once for multiple traces (failure: %s)',
    async (failure) => {
      if (failure) sdk.projects.mockRejectedValue(new Error('offline'));
      const exporter = createLangfuseTraceExporter(env);
      for (const requestId of ['first', 'second', 'third']) {
        await exporter.startScenario({ requestId }).end({});
      }
      const result = await exporter.flush();
      expect(sdk.projects).toHaveBeenCalledExactlyOnceWith(
        {},
        expect.objectContaining({
          timeoutInSeconds: 5,
          maxRetries: 0,
          abortSignal: expect.any(AbortSignal)
        })
      );
      expect(Object.keys(result.langfuseTraceUrls ?? {})).toHaveLength(failure ? 0 : 3);
      if (!failure)
        expect(result.langfuseTraceUrls?.first).toMatch(
          /^https:\/\/self-hosted.test\/project\/project-1\/traces\/[a-f0-9]{32}$/
        );
      expect(sdk.shutdown).toHaveBeenCalledOnce();
    }
  );

  it('exports native token counts only on generation spans, preserving zero usage', async () => {
    const exporter = createLangfuseTraceExporter(env);
    const root = exporter.startScenario({ requestId: 'request', model: 'test' });
    const usage = { input_tokens: 10, output_tokens: 0, total_tokens: 10 };
    await root.startLlm({ turn: 0, inputs: {} }).end({ outputs: { usage_metadata: usage } });
    await root
      .startTool({ server: 'server', tool: 'tool', inputs: {} })
      .end({ outputs: { usage_metadata: usage } });
    await root.end({});
    await exporter.flush();
    expect(sdk.spans[0].attributes['langfuse.observation.usage_details']).toBe(
      JSON.stringify({ input: 10, output: 0, total: 10 })
    );
    expect(sdk.spans[1].attributes['langfuse.observation.usage_details']).toBeUndefined();
    expect(sdk.spans[0].parentSpanContext?.spanId).toBe(sdk.spans[2].spanContext().spanId);
  });
});
