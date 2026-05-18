import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, extname, resolve, join, sep, relative } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  type AnySchema,
  type SchemaOutput,
  type ShapeOutput,
  type ZodRawShapeCompat
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  loadConfig,
  runAll,
  selectScenarios,
  loadOrBuildSearchIndex,
  indexNeedsRefresh,
  getResultsIndexPaths,
  normalizeResultsJson,
  resolveRunArtifactPath,
  searchDocs,
  getContext,
  type EvalConfig,
  type ExecutableEvalConfig,
  type ResultsJson,
  type SearchDoc,
  type SearchHit,
  type ResultSource,
  type ScenarioRunTraceRecord,
  type TraceMessage,
  type TraceMessageContentBlock
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import {
  buildAggregateRunsReport,
  buildCompareRunsReport,
  type LoadedRunResult
} from './mcp-run-calculations.js';

const PACKAGE_JSON = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version?: string };
const SERVER_VERSION =
  typeof PACKAGE_JSON.version === 'string' && PACKAGE_JSON.version.trim().length > 0
    ? PACKAGE_JSON.version
    : '0.0.0';
const SERVER_ICON_URL = 'https://mcplab.inspectr.dev/favicon.svg';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type ToolAnnotationHints = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

type MarkdownReportListItem = {
  path: string;
  relativePath: string;
  name: string;
  sizeBytes: number;
  mtime: string;
};

type ServerOwnedRoots = {
  reportsDir: string;
  runsDir: string;
  toolAnalysisDir: string;
  bundleRoot: string;
};

const SERVER_OWNED_ROOTS: ServerOwnedRoots = resolveServerOwnedRoots();

const DEFAULT_MCP_PATH = '/mcp';
const DEFAULT_MCP_PORT = 3011;
const DEFAULT_MCP_HOST = '127.0.0.1';
const MAX_MARKDOWN_REPORT_READ_BYTES = 2 * 1024 * 1024;

const GenericObjectSchema = z.object({}).passthrough();

const ResultsSummarySchema = z.object({
  total_scenarios: z.number().int().nonnegative(),
  total_runs: z.number().int().nonnegative(),
  pass_rate: z.number(),
  avg_tool_calls_per_run: z.number(),
  avg_tool_latency_ms: z.number().nullable()
});

const ResultsMetadataSchema = z
  .object({
    run_id: z.string(),
    timestamp: z.string(),
    config_hash: z.string(),
    cli_version: z.string(),
    mcp_server_versions: z.record(z.string())
  })
  .passthrough();

const ResultsQueryStatusSchema = z.enum(['passed', 'failed', 'all']);
const ResultsQuerySourceSchema = z.enum(['results', 'trace', 'summary']);

const MetricSummarySchema = z.object({
  total_runs: z.number().int().nonnegative(),
  passed_runs: z.number().int().nonnegative(),
  failed_runs: z.number().int().nonnegative(),
  pass_rate: z.number(),
  avg_tool_calls_per_run: z.number(),
  avg_tool_latency_ms: z.number().nullable()
});

const AggregateRowSchema = z.object({
  key: z.string(),
  run_id: z.string().optional(),
  scenario_id: z.string().optional(),
  agent: z.string().optional(),
  run_count: z.number().int().nonnegative(),
  timestamp_range: z
    .object({
      min: z.string(),
      max: z.string()
    })
    .optional(),
  total_runs: z.number().int().nonnegative(),
  passed_runs: z.number().int().nonnegative(),
  failed_runs: z.number().int().nonnegative(),
  pass_rate: z.number(),
  avg_tool_calls_per_run: z.number(),
  avg_tool_latency_ms: z.number().nullable()
});

const CompareRowSchema = z.object({
  key: z.string(),
  scenario_id: z.string(),
  agent: z.string(),
  classification: z.enum(['regressed', 'improved', 'unchanged', 'new', 'missing']),
  left: MetricSummarySchema.nullable(),
  right: MetricSummarySchema.nullable(),
  deltas: z.object({
    pass_rate: z.number().nullable(),
    failed_runs: z.number().nullable(),
    avg_tool_calls_per_run: z.number().nullable(),
    avg_tool_latency_ms: z.number().nullable()
  })
});

const RunListEntrySchema = z.object({
  run_id: z.string(),
  path: z.string(),
  summary: ResultsSummarySchema.optional(),
  metadata: ResultsMetadataSchema.optional(),
  summary_error: z.string().optional()
});

const LibraryScenarioEntrySchema = z.object({
  file: z.string(),
  id: z.string().optional(),
  content: GenericObjectSchema.optional(),
  yaml: z.string().optional()
});

const AgentEntrySchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'azure_openai']),
  model: z.string(),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  system: z.string().optional()
});

const LibraryServerEntryContentSchema = z
  .object({
    transport: z.string().optional(),
    url: z.string().optional(),
    auth: GenericObjectSchema.optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional()
  })
  .passthrough();

const LibraryServerEntrySchema = z.object({
  id: z.string(),
  entry: LibraryServerEntryContentSchema.optional()
});

const LibraryAgentEntrySchema = z.object({
  id: z.string(),
  entry: AgentEntrySchema.optional()
});

const LibraryEntrySchema = z.object({
  bundleRoot: z.string(),
  servers: z.array(LibraryServerEntrySchema),
  agents: z.array(LibraryAgentEntrySchema),
  scenarios: z.array(LibraryScenarioEntrySchema)
});

const ServerAuthSchema = z.union([
  z.object({
    type: z.literal('bearer'),
    token: z.string()
  }),
  z.object({
    type: z.literal('api_key'),
    header_name: z.string().optional(),
    value: z.string()
  }),
  z.object({
    type: z.literal('oauth_client_credentials'),
    token_url: z.string(),
    client_id_env: z.string(),
    client_secret_env: z.string(),
    scope: z.string().optional(),
    audience: z.string().optional()
  })
]);

const ServerEntrySchema = z.object({
  transport: z.literal('http'),
  url: z.string(),
  auth: ServerAuthSchema.optional()
});

const ScenarioEntrySchema = z.object({
  id: z.string(),
  agent: z.string().optional(),
  servers: z.array(z.string()),
  prompt: z.string(),
  snapshot_eval_enabled: z.boolean().optional(),
  eval: GenericObjectSchema.optional(),
  extract: z
    .array(
      z.object({
        name: z.string(),
        from: z.string(),
        regex: z.string()
      })
    )
    .optional()
});

const ConfigSummarySchema = z.object({
  server_count: z.number().int().nonnegative(),
  agent_count: z.number().int().nonnegative(),
  scenario_count: z.number().int().nonnegative(),
  servers: z.array(z.string()),
  agents: z.array(z.string()),
  scenarios: z.array(
    z.object({
      id: z.string(),
      servers: z.array(z.string()),
      has_eval: z.boolean(),
      extract_count: z.number().int().nonnegative()
    })
  )
});

const ResolvedScenarioSchema = z.object({
  id: z.string(),
  servers: z.array(z.string()),
  agent: z.string().optional(),
  prompt: z.string().optional(),
  eval: z
    .object({
      type: z.string(),
      assertions: z.array(z.string()).optional(),
      rubric: GenericObjectSchema.optional()
    })
    .passthrough()
    .optional(),
  extract: z
    .array(
      z
        .object({
          name: z.string(),
          from: z.string().optional(),
          regex: z.string().optional(),
          path: z.string().optional(),
          expression: z.string().optional(),
          transform: z.string().optional()
        })
        .passthrough()
    )
    .optional()
});

const RunDefaultsSchema = z
  .object({
    selected_agents: z.array(z.string()).optional(),
    runs_per_scenario: z.number().int().positive().optional(),
    timeout_ms: z.number().int().positive().optional(),
    retries: z.number().int().nonnegative().optional(),
    concurrency: z.number().int().positive().optional()
  })
  .passthrough();

const ToolAnalysisListItemSchema = z.object({
  report_id: z.string(),
  path: z.string().optional(),
  error: z.string().optional(),
  reportId: z.string().optional(),
  createdAt: z.string().optional(),
  sourceJobId: z.string().optional(),
  serverNames: z.array(z.string()).optional(),
  assistantAgentName: z.string().optional(),
  assistantAgentModel: z.string().optional(),
  modes: GenericObjectSchema.optional(),
  summary: GenericObjectSchema.optional()
});

const ToolAnalysisSummarySchema = z.object({
  reportId: z.string().optional(),
  createdAt: z.string().optional(),
  sourceJobId: z.string().optional(),
  serverNames: z.array(z.string()).optional(),
  assistantAgentName: z.string().optional(),
  assistantAgentModel: z.string().optional(),
  modes: GenericObjectSchema.optional(),
  summary: GenericObjectSchema.optional()
});

const FlattenedTraceItemSchema = z.union([
  z.object({
    type: z.literal('message'),
    record_index: z.number().int().nonnegative(),
    message_index: z.number().int().nonnegative(),
    scenario_id: z.string(),
    agent: z.string(),
    role: z.enum(['user', 'assistant', 'tool']),
    ts: z.string(),
    usage: z.unknown().optional()
  }),
  z.object({
    type: z.literal('text'),
    record_index: z.number().int().nonnegative(),
    message_index: z.number().int().nonnegative(),
    block_index: z.number().int().nonnegative(),
    scenario_id: z.string(),
    agent: z.string(),
    role: z.enum(['user', 'assistant', 'tool']),
    ts: z.string(),
    text: z.string()
  }),
  z.object({
    type: z.literal('tool_use'),
    record_index: z.number().int().nonnegative(),
    message_index: z.number().int().nonnegative(),
    block_index: z.number().int().nonnegative(),
    scenario_id: z.string(),
    agent: z.string(),
    role: z.enum(['user', 'assistant', 'tool']),
    ts: z.string(),
    id: z.string(),
    name: z.string(),
    server: z.string(),
    input: z.unknown()
  }),
  z.object({
    type: z.literal('tool_result'),
    record_index: z.number().int().nonnegative(),
    message_index: z.number().int().nonnegative(),
    block_index: z.number().int().nonnegative(),
    scenario_id: z.string(),
    agent: z.string(),
    role: z.enum(['user', 'assistant', 'tool']),
    ts: z.string(),
    tool_use_id: z.string(),
    name: z.string(),
    server: z.string(),
    is_error: z.boolean().optional(),
    duration_ms: z.number().optional(),
    content: z.unknown()
  })
]);

const ConversationTimelineItemSchema = z.union([
  z.object({
    index: z.number().int().nonnegative(),
    type: z.enum(['agent_message', 'user_message', 'tool_text']),
    role: z.enum(['user', 'assistant', 'tool']),
    ts: z.string(),
    message_index: z.number().int().nonnegative(),
    block_index: z.number().int().nonnegative(),
    text: z.string()
  }),
  z.object({
    index: z.number().int().nonnegative(),
    type: z.literal('tool_call'),
    role: z.enum(['user', 'assistant', 'tool']),
    ts: z.string(),
    message_index: z.number().int().nonnegative(),
    block_index: z.number().int().nonnegative(),
    id: z.string(),
    server: z.string(),
    tool: z.string(),
    args: z.unknown()
  }),
  z.object({
    index: z.number().int().nonnegative(),
    type: z.literal('tool_result'),
    role: z.enum(['user', 'assistant', 'tool']),
    ts: z.string(),
    message_index: z.number().int().nonnegative(),
    block_index: z.number().int().nonnegative(),
    tool_use_id: z.string(),
    server: z.string(),
    tool: z.string(),
    ok: z.boolean(),
    duration_ms: z.number().optional(),
    content: z.array(
      z
        .object({
          text: z.string()
        })
        .passthrough()
    )
  })
]);

const WriteMarkdownReportSuccessSchema = z.object({
  ok: z.literal(true),
  path: z.string().describe('Resolved absolute path to the written markdown file.'),
  bytes: z.number().int().nonnegative().describe('UTF-8 byte length written to disk.'),
  chars: z.number().int().nonnegative().describe('Character count written to disk.'),
  overwritten: z.boolean().describe('True when an existing file was replaced.'),
  workspace_root: z.string().describe('Workspace root used for path safety validation.')
});

const WriteMarkdownReportErrorCodeSchema = z.enum([
  'PATH_ESCAPE',
  'PERMISSION_DENIED',
  'FILE_EXISTS',
  'INVALID_EXTENSION',
  'PARENT_DIR_MISSING',
  'IO_ERROR'
]);

const WriteMarkdownReportErrorSchema = z.object({
  ok: z.literal(false),
  error_code: WriteMarkdownReportErrorCodeSchema,
  error_message: z.string(),
  attempted_path: z.string().optional(),
  violated_constraint: z.string().optional()
});

const WriteMarkdownReportOutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
  chars: z.number().int().nonnegative().optional(),
  overwritten: z.boolean().optional(),
  workspace_root: z.string().optional(),
  error_code: WriteMarkdownReportErrorCodeSchema.optional(),
  error_message: z.string().optional(),
  attempted_path: z.string().optional(),
  violated_constraint: z.string().optional()
});

const SafeRelativePathSchema = z
  .string()
  .max(200)
  .regex(
    /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+$/,
    'Must be a relative workspace path without ".." segments or absolute prefixes.'
  );

const GenerateServerEntryInputCoreSchema = z.object({
  id: z.string().describe('Server id key (kebab-case recommended).'),
  url: z.string().describe('MCP server URL (Streamable HTTP endpoint).'),
  transport: z.enum(['http']).optional().describe('MCPLab transport type (currently http).')
});

const GenerateServerEntryInputBaseSchema = GenerateServerEntryInputCoreSchema.extend({
  auth_type: z
    .enum(['none', 'bearer', 'api_key', 'oauth_client_credentials'])
    .optional()
    .describe('Authentication mode.'),
  bearer_token: z
    .string()
    .optional()
    .describe('Direct bearer token value or ${VAR} env reference when auth_type=bearer.'),
  bearer_env: z.string().optional().describe('Env var for bearer token when auth_type=bearer.'),
  api_key_header_name: z
    .string()
    .optional()
    .describe('Header name for API key auth (default: X-API-Key).'),
  api_key_value: z
    .string()
    .optional()
    .describe('API key value or ${VAR} env reference when auth_type=api_key.'),
  oauth_token_url: z
    .string()
    .optional()
    .describe('OAuth token URL when auth_type=oauth_client_credentials.'),
  oauth_client_id_env: z.string().optional().describe('OAuth client id env var.'),
  oauth_client_secret_env: z.string().optional().describe('OAuth client secret env var.'),
  oauth_scope: z.string().optional().describe('Optional OAuth scope.'),
  oauth_audience: z.string().optional().describe('Optional OAuth audience.')
});

const GenerateServerEntryPublicInputSchema = z.union([
  GenerateServerEntryInputCoreSchema.extend({
    auth_type: z.enum(['none']).optional()
  }),
  GenerateServerEntryInputCoreSchema.extend({
    auth_type: z.literal('bearer'),
    bearer_token: z.string(),
    bearer_env: z.string().optional()
  }),
  GenerateServerEntryInputCoreSchema.extend({
    auth_type: z.literal('bearer'),
    bearer_token: z.string().optional(),
    bearer_env: z.string()
  }),
  GenerateServerEntryInputCoreSchema.extend({
    auth_type: z.literal('api_key'),
    api_key_header_name: z.string().optional(),
    api_key_value: z.string()
  }),
  GenerateServerEntryInputCoreSchema.extend({
    auth_type: z.literal('oauth_client_credentials'),
    oauth_token_url: z.string(),
    oauth_client_id_env: z.string(),
    oauth_client_secret_env: z.string(),
    oauth_scope: z.string().optional(),
    oauth_audience: z.string().optional()
  })
]);

const GenerateServerEntryInputSchema = GenerateServerEntryInputBaseSchema.superRefine(
  (value, ctx) => {
    const authType = value.auth_type ?? 'none';
    if (authType === 'bearer') {
      if (!value.bearer_token && !value.bearer_env) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'auth_type=bearer requires at least one of bearer_token or bearer_env.'
        });
      }
    }
    if (authType === 'api_key') {
      if (!value.api_key_value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'auth_type=api_key requires api_key_value.'
        });
      }
    }
    if (authType === 'oauth_client_credentials') {
      if (!value.oauth_token_url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'auth_type=oauth_client_credentials requires oauth_token_url.'
        });
      }
      if (!value.oauth_client_id_env) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'auth_type=oauth_client_credentials requires oauth_client_id_env.'
        });
      }
      if (!value.oauth_client_secret_env) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'auth_type=oauth_client_credentials requires oauth_client_secret_env.'
        });
      }
    }
  }
);

export type SessionRuntime = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
};

export interface McplabMcpServerOptions {
  host: string;
  port: number;
  path: string;
  logger?: Pick<Console, 'log' | 'error'>;
}

export interface McplabMcpServerRuntime {
  host: string;
  port: number;
  path: string;
  close(): Promise<void>;
}

export async function startMcplabMcpServer(
  options: McplabMcpServerOptions
): Promise<McplabMcpServerRuntime> {
  const logger = options.logger ?? console;
  const sessions = new Map<string, SessionRuntime>();
  const httpServer = createServer(async (req, res) => {
    try {
      await handleHttpRequest(req, res, sessions, options.path);
    } catch (error) {
      logger.error('[mcplab-mcp-server] request error:', error);
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once('error', rejectListen);
    httpServer.listen(options.port, options.host, () => {
      httpServer.off('error', rejectListen);
      logger.error(
        `[mcplab-mcp-server] Streamable HTTP listening on http://${options.host}:${options.port}${options.path}`
      );
      resolveListen();
    });
  });

  const close = async () => {
    for (const [sessionId, runtime] of sessions) {
      try {
        await runtime.transport.close();
        await runtime.server.close();
      } catch (error) {
        logger.error(`[mcplab-mcp-server] failed to close session ${sessionId}:`, error);
      }
    }
    sessions.clear();
    await new Promise<void>((resolveClose) => {
      httpServer.close(() => resolveClose());
    });
  };

  return {
    host: options.host,
    port: options.port,
    path: options.path,
    close
  };
}

export function defaultMcplabMcpServerOptionsFromEnv(): McplabMcpServerOptions {
  return {
    host: process.env.MCP_HOST || DEFAULT_MCP_HOST,
    port: Number.parseInt(process.env.MCP_PORT ?? String(DEFAULT_MCP_PORT), 10),
    path: process.env.MCP_PATH || DEFAULT_MCP_PATH
  };
}

export function createConfiguredServer(): McpServer {
  const server = new McpServer({
    name: 'mcplab-assistant-server',
    version: SERVER_VERSION,
    title: 'MCPLab Assistant Server',
    description: 'MCPLab MCP tools for configs, runs, results, traces, and report workflows.',
    websiteUrl: 'https://mcplab.inspectr.dev',
    icons: [{ src: SERVER_ICON_URL, mimeType: 'image/svg+xml' }]
  });
  registerTools(server);
  registerPrompts(server);
  return server;
}

export function registerTools(server: McpServer): void {
  const registerTool = <
    OutputArgs extends ZodRawShapeCompat | AnySchema = AnySchema,
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined
  >(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: InputArgs;
      outputSchema?: OutputArgs;
      annotations?: ToolAnnotationHints;
      _meta?: Record<string, unknown>;
    },
    cb: (
      args: InputArgs extends ZodRawShapeCompat
        ? ShapeOutput<InputArgs>
        : InputArgs extends AnySchema
        ? SchemaOutput<InputArgs>
        : never
    ) => unknown
  ): void => {
    const resolvedTitle = resolveToolTitle(name, config.title, config.annotations?.title);
    const outputSchema =
      config.outputSchema ?? z.object({}).passthrough().describe('Structured tool response.');
    server.registerTool(
      name,
      {
        ...config,
        title: resolvedTitle,
        outputSchema,
        annotations: inferToolAnnotations(name, resolvedTitle, config.annotations)
      },
      cb as never
    );
  };

  registerTool(
    'mcplab_write_markdown_report',
    {
      description:
        'Write a Markdown (.md or .markdown) file to a path within the current workspace. Returns structured output with ok:true and the resolved path on success. On failure, returns ok:false with an error_code from: PATH_ESCAPE (path traversal attempt), FILE_EXISTS (file already exists and overwrite is false), PERMISSION_DENIED, PARENT_DIR_MISSING (create_dirs is false and parent does not exist), INVALID_EXTENSION (not .md or .markdown), IO_ERROR.',
      outputSchema: WriteMarkdownReportOutputSchema,
      inputSchema: {
        output_path: z
          .string()
          .max(200)
          .regex(/^[^\0]+\.(?:md|markdown)$/i, 'output_path must end with .md or .markdown.')
          .describe(
            "Target .md/.markdown path. Use a relative path (e.g. mcplab/reports/my-report.md) — relative paths are always safe and resolve against the server's working directory (process.cwd()). Absolute paths are accepted only if they stay inside that directory; any path that escapes it is rejected with error_code PATH_ESCAPE."
          ),
        markdown: z
          .string()
          .min(1, 'Markdown content must not be empty.')
          .max(10485760, 'Markdown must not exceed 10 MiB')
          .describe('Markdown content to write. Maximum 10 MiB.'),
        overwrite: z
          .boolean()
          .default(false)
          .describe('Overwrite existing file if true. Defaults to false.'),
        create_dirs: z
          .boolean()
          .default(true)
          .describe('Create missing parent directories if true. Defaults to true.')
      }
    },
    async ({ output_path, markdown, overwrite, create_dirs }) => {
      try {
        const targetPath = resolvePathInsideWorkspace(output_path);
        const extension = extname(targetPath).toLowerCase();
        if (extension !== '.md' && extension !== '.markdown') {
          const structured = {
            ok: false as const,
            error_code: 'INVALID_EXTENSION' as const,
            error_message: 'output_path must end with .md or .markdown',
            attempted_path: output_path,
            violated_constraint: 'MARKDOWN_EXTENSION_REQUIRED'
          };
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error: ${structured.error_message}` }],
            structuredContent: structured
          };
        }
        const parentDir = dirname(targetPath);
        if (create_dirs) {
          try {
            mkdirSync(parentDir, { recursive: true });
          } catch (error: unknown) {
            const code =
              typeof error === 'object' && error !== null && 'code' in error
                ? String((error as { code?: unknown }).code ?? '')
                : '';
            const structured = {
              ok: false as const,
              error_code: (code === 'EACCES' || code === 'EPERM'
                ? 'PERMISSION_DENIED'
                : 'IO_ERROR') as 'PERMISSION_DENIED' | 'IO_ERROR',
              error_message: error instanceof Error ? error.message : String(error),
              attempted_path: targetPath
            };
            return {
              isError: true,
              content: [{ type: 'text' as const, text: `Error: ${structured.error_message}` }],
              structuredContent: structured
            };
          }
        } else if (!existsSync(parentDir)) {
          const structured = {
            ok: false as const,
            error_code: 'PARENT_DIR_MISSING' as const,
            error_message: `Parent directory does not exist: ${parentDir}`,
            attempted_path: targetPath
          };
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error: ${structured.error_message}` }],
            structuredContent: structured
          };
        }
        const fileExists = existsSync(targetPath);
        if (fileExists && !overwrite) {
          const structured = {
            ok: false as const,
            error_code: 'FILE_EXISTS' as const,
            error_message: `File already exists: ${targetPath} (set overwrite=true to replace it)`,
            attempted_path: targetPath
          };
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error: ${structured.error_message}` }],
            structuredContent: structured
          };
        }
        const normalized = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
        try {
          writeFileSync(targetPath, normalized, 'utf8');
        } catch (error: unknown) {
          const code =
            typeof error === 'object' && error !== null && 'code' in error
              ? String((error as { code?: unknown }).code ?? '')
              : '';
          const structured = {
            ok: false as const,
            error_code: (code === 'EACCES' || code === 'EPERM'
              ? 'PERMISSION_DENIED'
              : 'IO_ERROR') as 'PERMISSION_DENIED' | 'IO_ERROR',
            error_message: error instanceof Error ? error.message : String(error),
            attempted_path: targetPath
          };
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Error: ${structured.error_message}` }],
            structuredContent: structured
          };
        }
        return ok(`Wrote Markdown report to ${targetPath}`, {
          ok: true,
          path: targetPath,
          bytes: Buffer.byteLength(normalized, 'utf8'),
          chars: normalized.length,
          overwritten: fileExists,
          workspace_root: process.cwd()
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isPathEscape = message.toLowerCase().includes('escapes workspace root');
        const structured = {
          ok: false as const,
          error_code: (isPathEscape ? 'PATH_ESCAPE' : 'IO_ERROR') as 'PATH_ESCAPE' | 'IO_ERROR',
          error_message: message,
          attempted_path: output_path,
          violated_constraint: isPathEscape ? 'WORKSPACE_CONTAINMENT' : undefined
        };
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Error: ${structured.error_message}` }],
          structuredContent: removeUndefined(structured)
        };
      }
    }
  );

  registerTool(
    'mcplab_search_markdown_reports',
    {
      description:
        'List saved markdown reports under mcplab/reports. Supports filtering by run id substring to find reports linked to a result.',
      outputSchema: {
        reports_dir: z.string(),
        run_id_filter: z.string().optional(),
        query: z.string().optional(),
        offset: z.number().int().min(0),
        limit: z.number().int().positive().max(200),
        returned: z.number().int().nonnegative(),
        total_matching: z.number().int().nonnegative(),
        next_offset: z.number().int().min(0).nullable(),
        items: z.array(
          z.object({
            path: z.string(),
            relativePath: z.string(),
            name: z.string(),
            sizeBytes: z.number().int().nonnegative(),
            mtime: z.string()
          })
        )
      },
      inputSchema: {
        run_id: z
          .string()
          .optional()
          .describe('Optional run id substring filter (matches path/name).'),
        query: z
          .string()
          .optional()
          .describe('Optional case-insensitive search query across report path/name fields.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .default(20)
          .describe('Max reports to return (default 20).'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Pagination offset into matching results (default 0).')
      }
    },
    async ({ run_id, query, limit, offset }) => {
      return withToolHandling(async () => {
        const root = resolveMarkdownReportsDir();
        const all = listMarkdownReportsFromDisk(root);
        const runFilter = String(run_id ?? '').trim();
        const searchQuery = String(query ?? '')
          .trim()
          .toLowerCase();
        const filtered = all.filter((item) => {
          if (
            runFilter &&
            !item.relativePath.includes(runFilter) &&
            !item.name.includes(runFilter)
          ) {
            return false;
          }
          if (!searchQuery) return true;
          const hay = `${item.path}\n${item.relativePath}\n${item.name}`.toLowerCase();
          return hay.includes(searchQuery);
        });
        const start = Math.max(0, offset ?? 0);
        const pageSize = limit ?? 20;
        const capped = filtered.slice(start, start + pageSize);
        const nextOffset = start + capped.length < filtered.length ? start + capped.length : null;
        return ok(`Found ${capped.length}/${filtered.length} markdown report(s) in ${root}`, {
          reports_dir: root,
          run_id_filter: runFilter || undefined,
          query: searchQuery || undefined,
          offset: start,
          limit: pageSize,
          returned: capped.length,
          total_matching: filtered.length,
          next_offset: nextOffset,
          items: capped
        });
      });
    }
  );

  registerTool(
    'mcplab_read_markdown_report',
    {
      description:
        'Read a saved markdown report by reports-root-relative path (under mcplab/reports), with optional truncation.',
      outputSchema: {
        reports_dir: z.string(),
        path: z.string(),
        relativePath: z.string(),
        name: z.string(),
        sizeBytes: z.number().int().nonnegative(),
        mtime: z.string(),
        truncated: z.boolean(),
        content: z.string()
      },
      inputSchema: {
        path: SafeRelativePathSchema.describe(
          'Report path relative to the reports root (e.g. team/run-2026-05-03.md). Do not prefix with mcplab/reports/.'
        ),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Optional truncation for markdown content preview (default 20000).')
      }
    },
    async ({ path, max_chars }) => {
      return withToolHandling(async () => {
        validateWorkspaceRelativePath(path, 'path');
        const root = resolveMarkdownReportsDir();
        const targetPath = resolveMarkdownReportPath(root, path);
        if (!isMarkdownReportExt(targetPath)) {
          throw new Error('path must point to a .md or .markdown file');
        }
        const st = statSync(targetPath);
        if (!st.isFile()) throw new Error(`Report not found: ${targetPath}`);
        if (st.size > MAX_MARKDOWN_REPORT_READ_BYTES) {
          throw new Error(`Report exceeds ${MAX_MARKDOWN_REPORT_READ_BYTES} bytes`);
        }
        const raw = readFileSync(targetPath, 'utf8');
        const preview = truncate(raw, max_chars ?? 20_000);
        return ok(
          `Read markdown report ${relative(process.cwd(), targetPath).split(sep).join('/')}`,
          {
            reports_dir: root,
            path: relative(process.cwd(), targetPath).split(sep).join('/'),
            relativePath: relative(root, targetPath).split(sep).join('/'),
            name: basename(targetPath),
            sizeBytes: st.size,
            mtime: st.mtime.toISOString(),
            truncated: preview.length < raw.length,
            content: preview
          }
        );
      });
    }
  );

  registerTool(
    'mcplab_list_library',
    {
      description:
        'List reusable MCPLab library entries (servers, agents, scenarios) from a bundle root such as mcplab/ or examples/libraries/.',
      outputSchema: LibraryEntrySchema,
      inputSchema: {
        kind: z
          .enum(['all', 'servers', 'agents', 'scenarios'])
          .optional()
          .describe('Which library category to list. Defaults to all.'),
        includeContent: z
          .boolean()
          .optional()
          .describe('Include parsed YAML content for each item (larger output).')
      }
    },
    async ({ kind, includeContent }) => {
      return withToolHandling(async () => {
        const root = resolveBundleRoot();
        const data = readLibrary(root, Boolean(includeContent));
        const selectedKind = kind ?? 'all';
        const structured =
          selectedKind === 'all'
            ? data
            : {
                bundleRoot: data.bundleRoot,
                servers: selectedKind === 'servers' ? data.servers : [],
                agents: selectedKind === 'agents' ? data.agents : [],
                scenarios: selectedKind === 'scenarios' ? data.scenarios : []
              };

        return ok(`Loaded MCPLab library from ${root}`, structured);
      });
    }
  );

  registerTool(
    'mcplab_get_library_item',
    {
      description:
        'Get a specific reusable server, agent, or scenario definition from a MCPLab library bundle and return both structured data and YAML.',
      outputSchema: {
        bundleRoot: z.string(),
        kind: z.enum(['servers', 'agents', 'scenarios']),
        id: z.string(),
        file: z.string().optional(),
        yaml: z.string(),
        content: GenericObjectSchema
      },
      inputSchema: {
        kind: z.enum(['servers', 'agents', 'scenarios']).describe('Library category.'),
        id: z.string().describe('Entry id (for scenarios this is scenario.id, not filename).')
      }
    },
    async ({ kind, id }) => {
      return withToolHandling(async () => {
        const root = resolveBundleRoot();
        const item = getLibraryItem(root, kind, id);
        return ok(`Loaded ${kind.slice(0, -1)} '${id}' from ${root}`, item);
      });
    }
  );

  registerTool(
    'mcplab_generate_server_entry',
    {
      description:
        'Generate a MCPLab servers.yaml entry (or inline config block) for an MCP server connection.',
      outputSchema: {
        id: z.string(),
        entry: ServerEntrySchema,
        yaml: z.string()
      },
      inputSchema: GenerateServerEntryPublicInputSchema
    },
    async (input) => {
      return withToolHandling(async () => {
        const parsed = GenerateServerEntryInputSchema.parse(input);
        const entry = buildServerEntry(parsed);
        return ok(`Generated server entry '${parsed.id}'`, {
          id: parsed.id,
          entry,
          yaml: stringifyYaml({ [parsed.id]: entry }).trimEnd()
        });
      });
    }
  );

  registerTool(
    'mcplab_generate_agent_entry',
    {
      description:
        'Generate a MCPLab agents.yaml entry (provider/model/system settings) for evaluation runs.',
      outputSchema: {
        id: z.string(),
        entry: AgentEntrySchema,
        yaml: z.string()
      },
      inputSchema: {
        id: z.string().describe('Agent id key (kebab-case recommended).'),
        provider: z
          .enum(['openai', 'anthropic', 'azure_openai'])
          .describe('LLM provider supported by MCPLab.'),
        model: z.string().describe('Model id or deployment name (for Azure OpenAI).'),
        temperature: z.number().optional().describe('Sampling temperature.'),
        max_tokens: z.number().int().positive().optional().describe('Maximum output tokens.'),
        system: z.string().optional().describe('Optional system prompt.')
      }
    },
    async ({ id, ...agent }) => {
      return withToolHandling(async () => {
        const entry = removeUndefined(agent);
        return ok(`Generated agent entry '${id}'`, {
          id,
          entry,
          yaml: stringifyYaml({ [id]: entry }).trimEnd()
        });
      });
    }
  );

  registerTool(
    'mcplab_generate_scenario_entry',
    {
      description:
        'Generate a MCPLab scenario YAML snippet with prompt, server links, and optional evaluation/extract rules. Optimized for scenario authoring workflows.',
      outputSchema: {
        scenario: ScenarioEntrySchema,
        yaml: z.string(),
        yaml_library_file: z.string(),
        yaml_inline_list_item: z.string(),
        format: z.enum(['library-scenario-file', 'inline-scenarios-list-item']),
        warnings: z.array(z.string())
      },
      inputSchema: {
        id: z
          .string()
          .optional()
          .describe('Scenario id (kebab-case). Auto-derived from name if omitted.'),
        name: z
          .string()
          .optional()
          .describe('Optional human label used only to derive id when id is omitted.'),
        agent: z
          .string()
          .optional()
          .describe('Optional pinned agent id. Omit to use mcplab run --agents selection.'),
        servers: z
          .array(z.string())
          .min(1)
          .describe('One or more server ids available to the scenario.'),
        prompt: z
          .string()
          .min(1)
          .max(4000)
          .describe('The task prompt the evaluation agent should execute (1-4000 chars).'),
        snapshot_eval_enabled: z
          .boolean()
          .optional()
          .describe('Per-scenario baseline drift evaluation toggle.'),
        required_tools: z.array(z.string()).optional().describe('Tools that must be called.'),
        forbidden_tools: z.array(z.string()).optional().describe('Tools that must not be called.'),
        allowed_tool_sequences: z
          .array(z.array(z.string()).min(1))
          .optional()
          .describe('Allowed tool call sequences (exact order groups).'),
        response_regex_patterns: z
          .array(z.string())
          .optional()
          .describe('Regex patterns that must match the final response text.'),
        extract_rules: z
          .array(
            z.object({
              name: z.string().describe('Extracted field name.'),
              regex: z.string().describe('Regex applied to final_text.')
            })
          )
          .optional()
          .describe('Value extraction rules from final_text.'),
        as_library_file: z
          .boolean()
          .optional()
          .describe(
            'True returns standalone scenario YAML file content; false returns list item snippet.'
          )
      }
    },
    async (input) => {
      return withToolHandling(async () => {
        const scenario = buildScenario(input);
        const asLibraryFile = Boolean(input.as_library_file);
        const yamlLibraryFile = stringifyYaml(scenario).trimEnd();
        const yamlInlineListItem = indentBlock(stringifyYaml([scenario]).trimEnd(), 2);
        const warnings = validateScenarioHeuristics(scenario);
        return ok(`Generated scenario '${scenario.id}'`, {
          scenario,
          yaml: asLibraryFile ? yamlLibraryFile : yamlInlineListItem,
          yaml_library_file: yamlLibraryFile,
          yaml_inline_list_item: yamlInlineListItem,
          format: asLibraryFile ? 'library-scenario-file' : 'inline-scenarios-list-item',
          warnings
        });
      });
    }
  );

  registerTool(
    'mcplab_validate_config',
    {
      description:
        'Validate and expand a MCPLab config file via mcplab-core loadConfig(), including server/agent/scenario library references.',
      outputSchema: {
        configPath: z.string(),
        bundleRoot: z.string(),
        hash: z.string(),
        summary: ConfigSummarySchema,
        resolved_config: z.object({
          servers: z.record(GenericObjectSchema),
          agents: z.record(AgentEntrySchema),
          scenarios: z.array(ResolvedScenarioSchema),
          run_defaults: RunDefaultsSchema.optional()
        })
      },
      inputSchema: {
        config_path: z.string().describe('Path to MCPLab eval YAML config.'),
        scenario_id: z
          .string()
          .optional()
          .describe('Optional single scenario id to validate selection.')
      }
    },
    async ({ config_path, scenario_id }) => {
      return withToolHandling(async () => {
        const loaded = loadConfig(resolve(config_path), {
          bundleRoot: resolveBundleRoot()
        });
        const selected = selectScenarios(loaded.config, scenario_id);
        const summary = summarizeConfig(selected);
        return ok(`Validated config ${config_path}`, {
          configPath: resolve(config_path),
          bundleRoot: detectLikelyBundleRoot(resolve(config_path)),
          hash: loaded.hash,
          summary,
          resolved_config: selected
        });
      });
    }
  );

  registerTool(
    'mcplab_run_eval',
    {
      description:
        'Run a MCPLab evaluation using mcplab-core runAll() from a config file and return the run directory plus summary metrics.',
      outputSchema: {
        run_dir: z.string(),
        total_scenarios: z.number().int().nonnegative(),
        total_runs: z.number().int().nonnegative(),
        passed_runs: z.number().int().nonnegative(),
        failed_runs: z.number().int().nonnegative(),
        skipped_runs: z.number().int().nonnegative(),
        duration_ms: z.number().nonnegative(),
        summary: ResultsSummarySchema,
        metadata: ResultsMetadataSchema,
        scenarios: z.array(
          z.object({
            scenario_id: z.string(),
            agent: z.string(),
            pass_rate: z.number(),
            tool_usage_frequency: z.record(z.number())
          })
        ),
        report_html_preview: z.string()
      },
      inputSchema: {
        config_path: z.string().describe('Path to MCPLab eval YAML config.'),
        scenario_id: z.string().optional().describe('Optional scenario id to run.'),
        runs_per_scenario: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Runs per scenario (default 1).')
      }
    },
    async ({ config_path, scenario_id, runs_per_scenario }) => {
      return withToolHandling(async () => {
        const loaded = loadConfig(resolve(config_path), {
          bundleRoot: resolveBundleRoot()
        });
        const selected = selectScenarios(loaded.config, scenario_id);
        const executable = expandConfigForAgents(selected, selected.run_defaults?.selected_agents);
        const { runDir, results } = await runAll(executable, {
          runsPerScenario: runs_per_scenario ?? 1,
          scenarioId: scenario_id,
          configHash: loaded.hash,
          cliVersion: `mcplab-mcp-server/${SERVER_VERSION}`,
          runsDir: resolveRunsDir()
        });

        const reportHtml = renderReport(results);
        const allRuns = results.scenarios.flatMap((scenario) => scenario.runs);
        const passedRuns = allRuns.filter((run) => run.pass === true).length;
        const failedRuns = allRuns.filter((run) => run.pass === false).length;
        const skippedRuns = Math.max(0, allRuns.length - passedRuns - failedRuns);
        const durationMs = allRuns.reduce((sum, run) => {
          const directRaw = (run as { duration_ms?: unknown }).duration_ms;
          const direct = typeof directRaw === 'number' ? directRaw : null;
          if (direct !== null) return sum + Math.max(0, direct);
          const fromToolDurations = Array.isArray(run.tool_durations_ms)
            ? run.tool_durations_ms.reduce(
                (runSum, value) =>
                  runSum + (typeof value === 'number' && Number.isFinite(value) ? value : 0),
                0
              )
            : 0;
          return sum + Math.max(0, fromToolDurations);
        }, 0);
        return ok(`MCPLab run completed: ${runDir}`, {
          run_dir: runDir,
          total_scenarios: results.summary.total_scenarios,
          total_runs: results.summary.total_runs,
          passed_runs: passedRuns,
          failed_runs: failedRuns,
          skipped_runs: skippedRuns,
          duration_ms: durationMs,
          summary: results.summary,
          metadata: results.metadata,
          scenarios: results.scenarios.map((scenario) => ({
            scenario_id: scenario.scenario_id,
            agent: scenario.agent,
            pass_rate: scenario.pass_rate,
            tool_usage_frequency: scenario.tool_usage_frequency
          })),
          report_html_preview: truncate(reportHtml, 4000)
        });
      });
    }
  );

  registerTool(
    'mcplab_aggregate_runs',
    {
      description:
        'Aggregate metrics across historical MCPLab runs with compact summary-first output.',
      outputSchema: z.object({
        runs: z.array(
          z.object({
            run_id: z.string(),
            timestamp: z.string(),
            config_hash: z.string()
          })
        ),
        group_by: z.enum(['run', 'scenario', 'agent']),
        filters: z
          .object({
            scenario_ids: z.array(z.string()).optional(),
            agents: z.array(z.string()).optional()
          })
          .optional(),
        summary: MetricSummarySchema.extend({
          selected_run_count: z.number().int().nonnegative()
        }),
        top_worst: z.array(AggregateRowSchema),
        top_best: z.array(AggregateRowSchema),
        details: z.array(AggregateRowSchema).optional()
      }),
      inputSchema: {
        run_ids: z
          .array(z.string())
          .optional()
          .describe(
            "Explicit run ids. If present, takes precedence over latest_n. Supports 'LATEST'."
          ),
        latest_n: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe(
            'Number of latest runs to aggregate when run_ids are not provided (default 20).'
          ),
        scenario_ids: z.array(z.string()).optional().describe('Optional scenario id filter.'),
        agents: z.array(z.string()).optional().describe('Optional agent filter.'),
        group_by: z
          .enum(['run', 'scenario', 'agent'])
          .optional()
          .describe('Grouping for row-level ranking (default run).'),
        top_n: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe('Max rows for worst/best ranking output (default 10).'),
        include_details: z
          .boolean()
          .optional()
          .describe('Include full grouped rows. Defaults to false (summary-first).')
      }
    },
    async ({ run_ids, latest_n, scenario_ids, agents, group_by, top_n, include_details }) => {
      return withToolHandling(async () => {
        const loaded = loadRunsForAnalysis({
          runIds: run_ids,
          latestN: latest_n ?? 20
        });
        const report = buildAggregateRunsReport({
          runs: loaded,
          scenarioIds: scenario_ids,
          agents,
          groupBy: group_by ?? 'run',
          topN: top_n ?? 10,
          includeDetails: include_details ?? false
        });
        return ok(`Aggregated ${loaded.length} run(s)`, report);
      });
    }
  );

  registerTool(
    'mcplab_compare_runs',
    {
      description:
        'Compare two MCPLab runs and surface compact deltas with regressions/improvements first.',
      outputSchema: z.object({
        left_run: z.object({
          run_id: z.string(),
          timestamp: z.string(),
          config_hash: z.string()
        }),
        right_run: z.object({
          run_id: z.string(),
          timestamp: z.string(),
          config_hash: z.string()
        }),
        filters: z
          .object({
            scenario_ids: z.array(z.string()).optional(),
            agents: z.array(z.string()).optional()
          })
          .optional(),
        summary: z.object({
          left: MetricSummarySchema,
          right: MetricSummarySchema,
          deltas: z.object({
            pass_rate: z.number(),
            failed_runs: z.number(),
            avg_tool_calls_per_run: z.number(),
            avg_tool_latency_ms: z.number().nullable()
          }),
          classification_counts: z.object({
            regressed: z.number().int().nonnegative(),
            improved: z.number().int().nonnegative(),
            unchanged: z.number().int().nonnegative(),
            new: z.number().int().nonnegative(),
            missing: z.number().int().nonnegative()
          })
        }),
        regressions: z.array(CompareRowSchema),
        improvements: z.array(CompareRowSchema),
        new_items: z.array(CompareRowSchema),
        missing_items: z.array(CompareRowSchema),
        details: z.array(CompareRowSchema).optional()
      }),
      inputSchema: {
        left_run_id: z.string().describe("Left run id or 'LATEST'."),
        right_run_id: z.string().describe("Right run id or 'LATEST'."),
        scenario_ids: z.array(z.string()).optional().describe('Optional scenario id filter.'),
        agents: z.array(z.string()).optional().describe('Optional agent filter.'),
        top_n: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe('Max rows for regressions/improvements (default 20).'),
        include_details: z
          .boolean()
          .optional()
          .describe('Include full classification rows. Defaults to false (summary-first).')
      }
    },
    async ({ left_run_id, right_run_id, scenario_ids, agents, top_n, include_details }) => {
      return withToolHandling(async () => {
        const base = resolveRunsDir();
        const left = loadSingleRunForAnalysis(base, left_run_id);
        const right = loadSingleRunForAnalysis(base, right_run_id);
        const report = buildCompareRunsReport({
          left,
          right,
          scenarioIds: scenario_ids,
          agents,
          topN: top_n ?? 20,
          includeDetails: include_details ?? false
        });
        return ok(`Compared run ${left.run_id} against ${right.run_id}`, report);
      });
    }
  );

  registerTool(
    'mcplab_search_tool_analysis_results',
    {
      description:
        'Search saved MCP tool analysis reports from mcplab/results/tool-analysis. Use the optional query parameter to filter by report_id, server name, agent name, or summary metadata (case-insensitive substring).',
      outputSchema: {
        tool_analysis_results_dir: z.string(),
        total: z.number().int().nonnegative(),
        items: z.array(ToolAnalysisListItemSchema)
      },
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            'Optional case-insensitive search query across report id/path/summary metadata.'
          ),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .default(20)
          .describe('Max reports to return. Defaults to 20.')
      }
    },
    async ({ query, limit }) => {
      return withToolHandling(async () => {
        const baseDir = resolveToolAnalysisResultsDir();
        const reports = listToolAnalysisReportsFromDiskWithFallback(baseDir, undefined);
        const searchQuery = String(query ?? '')
          .trim()
          .toLowerCase();
        const filtered = searchQuery
          ? reports.filter((report) => searchableText(report).includes(searchQuery))
          : reports;
        const capped = filtered.slice(0, limit);
        return ok(`Found ${filtered.length} tool analysis report(s) in ${baseDir}`, {
          tool_analysis_results_dir: baseDir,
          query: searchQuery || undefined,
          total: filtered.length,
          items: capped
        });
      });
    }
  );

  registerTool(
    'mcplab_read_tool_analysis_result',
    {
      description:
        'Read a saved MCP tool analysis report record (report.json) by report id and return parsed metadata plus optional raw JSON preview.',
      outputSchema: z.object({
        path: z.string(),
        report_id: z.string(),
        truncated: z.boolean(),
        raw_json_preview: z.string(),
        summary: ToolAnalysisSummarySchema,
        record: GenericObjectSchema.optional()
      }),
      inputSchema: {
        report_id: z.string().describe("Report id directory name (or 'LATEST')."),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Optional truncation for raw JSON preview (default 20000).'),
        include_record: z
          .boolean()
          .optional()
          .describe('Include the full parsed record in structured content. Defaults to true.')
      }
    },
    async ({ report_id, max_chars, include_record }) => {
      return withToolHandling(async () => {
        const baseDir = resolveToolAnalysisResultsDir();
        const resolvedReportId =
          report_id === 'LATEST'
            ? latestToolAnalysisReportIdWithFallback(baseDir)
            : report_id.trim();
        if (!resolvedReportId) {
          throw new Error(`No tool analysis reports found in ${baseDir}`);
        }
        const filePath = toolAnalysisReportFilePathWithFallback(baseDir, resolvedReportId);
        if (!existsSync(filePath)) {
          throw new Error(`Tool analysis report not found: ${filePath}`);
        }
        const raw = readFileSync(filePath, 'utf8');
        const parsed = parseToolAnalysisRecord(raw);
        const content = truncate(raw, max_chars ?? 20_000);
        const summary = summarizeToolAnalysisRecord(parsed);
        const structured = removeUndefined({
          path: filePath,
          report_id: resolvedReportId,
          truncated: content.length < raw.length,
          raw_json_preview: content,
          summary,
          record: include_record === false ? undefined : parsed
        });
        return ok(`Read tool analysis report ${resolvedReportId}`, structured);
      });
    }
  );

  registerTool(
    'mcplab_delete_tool_analysis_result',
    {
      description:
        'Delete a saved MCP tool analysis report directory by report id (from mcplab/results/tool-analysis by default).',
      outputSchema: {
        status: z.enum(['deleted', 'not_found', 'dry_run']),
        report_id: z.string(),
        path: z.string(),
        tool_analysis_results_dir: z.string(),
        existed: z.boolean(),
        deleted: z.boolean(),
        would_delete: z.boolean()
      },
      inputSchema: {
        report_id: z.string().describe('Report id directory name to delete.'),
        dry_run: z
          .boolean()
          .default(false)
          .describe(
            'If true, return what would be deleted without deleting anything. Defaults to false.'
          ),
        confirm: z
          .boolean()
          .default(false)
          .describe(
            'Must be true to execute deletion when dry_run is false. If confirm is false, deletion is rejected with an error.'
          )
      }
    },
    async ({ report_id, dry_run, confirm }) => {
      return withToolHandling(async () => {
        const baseDir = resolveToolAnalysisResultsDir();
        const dirPath = toolAnalysisReportDirPathWithFallback(baseDir, report_id.trim());
        const existed = existsSync(dirPath);
        const isDryRun = Boolean(dry_run);
        if (isDryRun) {
          return ok(`Dry run for delete tool analysis report ${report_id}`, {
            status: 'dry_run',
            report_id: report_id.trim(),
            path: dirPath,
            tool_analysis_results_dir: baseDir,
            existed,
            deleted: false,
            would_delete: existed
          });
        }
        if (confirm !== true) {
          throw new Error('confirm=true is required to delete a tool analysis report');
        }
        if (!existed) {
          return ok(`Tool analysis report not found: ${report_id}`, {
            status: 'not_found',
            report_id: report_id.trim(),
            path: dirPath,
            tool_analysis_results_dir: baseDir,
            existed: false,
            deleted: false,
            would_delete: false
          });
        }
        rmSync(dirPath, { recursive: true, force: false });
        return ok(`Deleted tool analysis report ${report_id}`, {
          status: 'deleted',
          report_id: report_id.trim(),
          path: dirPath,
          tool_analysis_results_dir: baseDir,
          existed: true,
          deleted: true,
          would_delete: true
        });
      });
    }
  );

  registerTool(
    'mcplab_trace_list_events',
    {
      description:
        'List structured trace timeline items for a MCPLab run (flattened from scenario_run trace records) with optional type/scenario/agent filtering.',
      outputSchema: {
        run_id: z.string(),
        legacy_trace_detected: z.boolean().optional(),
        total_matching: z.number().int().nonnegative(),
        items: z.array(FlattenedTraceItemSchema)
      },
      inputSchema: {
        run_id: z.string().describe("Run id directory name or 'LATEST'."),
        event_types: z
          .array(z.string())
          .optional()
          .describe('Optional timeline item type filters (e.g. text, tool_use, tool_result).'),
        scenario_id: z.string().optional().describe('Optional scenario id filter.'),
        agent: z.string().optional().describe('Optional agent filter.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe('Max items to return (default 200).')
      }
    },
    async ({ run_id, event_types, scenario_id, agent, limit }) => {
      return withToolHandling(async () => {
        const { runId, records, legacyDetected } = readScenarioRunTraceRecordsForRun(run_id);
        const typeSet: Set<string> | null = event_types?.length
          ? new Set<string>(event_types)
          : null;
        const flattened = flattenScenarioRunTraceRecords(records);
        const filtered = flattened.filter((item) => {
          const itemType = typeof item.type === 'string' ? item.type : '';
          const itemScenario = typeof item.scenario_id === 'string' ? item.scenario_id : undefined;
          const itemAgent = typeof item.agent === 'string' ? item.agent : undefined;
          if (typeSet && !typeSet.has(itemType)) return false;
          if (scenario_id && itemScenario !== scenario_id) return false;
          if (agent && itemAgent !== agent) return false;
          return true;
        });
        const max = limit ?? 200;
        const items = filtered.slice(0, max);
        return ok(`Listed ${items.length}/${filtered.length} trace item(s) for run ${runId}`, {
          run_id: runId,
          legacy_trace_detected: legacyDetected || undefined,
          total_matching: filtered.length,
          items
        });
      });
    }
  );

  registerTool(
    'mcplab_trace_get_final_answers',
    {
      description:
        'Extract final assistant answers from a run trace (scenario_run documents) for easy agent output comparison.',
      outputSchema: {
        run_id: z.string(),
        legacy_trace_detected: z.boolean().optional(),
        items: z.array(
          z.object({
            index: z.number().int().nonnegative(),
            scenario_id: z.string(),
            agent: z.string(),
            ts: z.string().optional(),
            truncated: z.boolean(),
            text: z.string()
          })
        )
      },
      inputSchema: {
        run_id: z.string().describe("Run id directory name or 'LATEST'."),
        scenario_id: z.string().optional().describe('Optional scenario id filter.'),
        agent: z.string().optional().describe('Optional agent filter.'),
        max_chars_per_answer: z
          .number()
          .int()
          .positive()
          .max(20000)
          .optional()
          .describe('Optional truncation per final answer text (default 8000).')
      }
    },
    async ({ run_id, scenario_id, agent, max_chars_per_answer }) => {
      return withToolHandling(async () => {
        const { runId, records, legacyDetected } = readScenarioRunTraceRecordsForRun(run_id);
        const maxChars = max_chars_per_answer ?? 8000;
        const items = records
          .filter(
            (record) =>
              (!scenario_id || record.scenario_id === scenario_id) &&
              (!agent || record.agent === agent)
          )
          .map((record, index) => {
            const full = extractFinalAssistantText(record);
            if (!full) return null;
            const text = truncate(full, maxChars);
            return removeUndefined({
              index,
              scenario_id: record.scenario_id,
              agent: record.agent,
              ts: record.ts_end,
              truncated: text.length < full.length,
              text
            });
          })
          .filter(Boolean);
        return ok(`Extracted ${items.length} final answer(s) from run ${runId}`, {
          run_id: runId,
          legacy_trace_detected: legacyDetected || undefined,
          items
        });
      });
    }
  );

  registerTool(
    'mcplab_trace_get_conversation',
    {
      description:
        'Return a structured conversation timeline (messages + tool blocks) for a specific scenario+agent in a scenario_run trace.',
      outputSchema: {
        run_id: z.string(),
        scenario_id: z.string(),
        agent: z.string(),
        legacy_trace_detected: z.boolean().optional(),
        timeline: z.array(ConversationTimelineItemSchema)
      },
      inputSchema: {
        run_id: z.string().describe("Run id directory name or 'LATEST'."),
        scenario_id: z.string().describe('Scenario id to filter.'),
        agent: z.string().describe('Agent name to filter.'),
        max_items: z
          .number()
          .int()
          .positive()
          .max(1000)
          .optional()
          .describe('Max timeline items (default 300).'),
        max_text_chars: z
          .number()
          .int()
          .positive()
          .max(20000)
          .optional()
          .describe('Max chars for text fields (default 4000).')
      }
    },
    async ({ run_id, scenario_id, agent, max_items, max_text_chars }) => {
      return withToolHandling(async () => {
        const { runId, records, legacyDetected } = readScenarioRunTraceRecordsForRun(run_id);
        const textMax = max_text_chars ?? 4000;
        const record = records.find((r) => r.scenario_id === scenario_id && r.agent === agent);
        const timeline = record
          ? buildConversationTimeline(record, textMax).slice(0, max_items ?? 300)
          : [];

        return ok(
          `Built conversation timeline (${timeline.length} items) for ${scenario_id} / ${agent}`,
          {
            run_id: runId,
            scenario_id,
            agent,
            legacy_trace_detected: legacyDetected || undefined,
            timeline
          }
        );
      });
    }
  );

  registerTool(
    'mcplab_trace_search',
    {
      description:
        'Search scenario_run trace content for a text query and return matching message/block items.',
      outputSchema: {
        run_id: z.string(),
        query: z.string().trim().min(1),
        legacy_trace_detected: z.boolean().optional(),
        matches: z.array(FlattenedTraceItemSchema)
      },
      inputSchema: {
        run_id: z.string().describe("Run id directory name or 'LATEST'."),
        query: z.string().describe('Case-insensitive text query.'),
        event_types: z
          .array(z.enum(['message', 'text', 'tool_use', 'tool_result']))
          .optional()
          .describe('Optional item type filters.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe('Max matches to return (default 50).')
      }
    },
    async ({ run_id, query, event_types, limit }) => {
      return withToolHandling(async () => {
        const q = query.trim().toLowerCase();
        if (!q) throw new Error('query is required');
        const { runId, records, legacyDetected } = readScenarioRunTraceRecordsForRun(run_id);
        const typeSet: Set<string> | null = event_types?.length
          ? new Set<string>(event_types)
          : null;
        const matches: Array<Record<string, unknown>> = [];
        for (const item of flattenScenarioRunTraceRecords(records)) {
          const itemType = typeof item.type === 'string' ? item.type : '';
          if (typeSet && !typeSet.has(itemType)) continue;
          const hay = JSON.stringify(item).toLowerCase();
          if (!hay.includes(q)) continue;
          matches.push(item);
          if (matches.length >= (limit ?? 50)) break;
        }
        return ok(`Found ${matches.length} trace match(es) for "${query}" in run ${runId}`, {
          run_id: runId,
          query,
          legacy_trace_detected: legacyDetected || undefined,
          matches
        });
      });
    }
  );

  registerTool(
    'mcplab_trace_stats',
    {
      description:
        'Compute trace statistics for a run (message/block counts, tool usage, durations, and final-answer counts).',
      outputSchema: {
        run_id: z.string(),
        legacy_trace_detected: z.boolean().optional(),
        total_scenario_records: z.number().int().nonnegative(),
        message_role_counts: z.record(z.number()),
        block_type_counts: z.record(z.number()),
        scenario_agent_pairs: z.number().int().nonnegative(),
        tool_call_count: z.number().int().nonnegative(),
        tool_result_count: z.number().int().nonnegative(),
        final_answer_count: z.number().int().nonnegative(),
        avg_tool_result_duration_ms: z.number().nullable(),
        tool_usage: z.array(
          z.object({
            tool: z.string(),
            count: z.number().int().nonnegative()
          })
        )
      },
      inputSchema: {
        run_id: z.string().describe("Run id directory name or 'LATEST'.")
      }
    },
    async ({ run_id }) => {
      return withToolHandling(async () => {
        const { runId, records, legacyDetected } = readScenarioRunTraceRecordsForRun(run_id);
        const messageRoleCounts: Record<string, number> = {};
        const blockTypeCounts: Record<string, number> = {};
        const toolUsage: Record<string, number> = {};
        const scenarioAgentKeys = new Set<string>();
        let toolCallCount = 0;
        let toolResultCount = 0;
        let finalAnswerCount = 0;
        let totalToolDurationMs = 0;
        for (const record of records) {
          scenarioAgentKeys.add(`${record.scenario_id}::${record.agent}`);
          finalAnswerCount += extractFinalAssistantText(record) ? 1 : 0;
          for (const message of record.messages) {
            messageRoleCounts[message.role] = (messageRoleCounts[message.role] ?? 0) + 1;
            for (const block of message.content) {
              blockTypeCounts[block.type] = (blockTypeCounts[block.type] ?? 0) + 1;
              if (block.type === 'tool_use') {
                toolCallCount += 1;
                const key = `${block.server}::${block.name}`;
                toolUsage[key] = (toolUsage[key] ?? 0) + 1;
              } else if (block.type === 'tool_result') {
                toolResultCount += 1;
                totalToolDurationMs += block.duration_ms ?? 0;
              }
            }
          }
        }
        return ok(`Computed trace stats for run ${runId}`, {
          run_id: runId,
          legacy_trace_detected: legacyDetected || undefined,
          total_scenario_records: records.length,
          message_role_counts: messageRoleCounts,
          block_type_counts: blockTypeCounts,
          scenario_agent_pairs: scenarioAgentKeys.size,
          tool_call_count: toolCallCount,
          tool_result_count: toolResultCount,
          final_answer_count: finalAnswerCount,
          avg_tool_result_duration_ms:
            toolResultCount > 0 ? Number((totalToolDurationMs / toolResultCount).toFixed(2)) : null,
          tool_usage: Object.entries(toolUsage)
            .sort((a, b) => b[1] - a[1])
            .map(([tool, count]) => ({ tool, count }))
        });
      });
    }
  );

  registerTool(
    'mcplab_read_run_artifact',
    {
      description:
        'Read MCPLab run artifacts such as results.json, summary.md, trace.jsonl, resolved-config.yaml, or report.html.',
      outputSchema: {
        path: z.string(),
        run_id: z.string(),
        artifact: z.enum([
          'results.json',
          'summary.md',
          'trace.jsonl',
          'resolved-config.yaml',
          'report.html'
        ]),
        line_range: z.string().optional(),
        truncated: z.boolean(),
        content: z.string(),
        summary: ResultsSummarySchema.optional(),
        metadata: ResultsMetadataSchema.optional(),
        scenarios: z
          .array(
            z.object({
              scenario_id: z.string(),
              agent: z.string(),
              pass_rate: z.number()
            })
          )
          .optional()
      },
      inputSchema: {
        run_id: z.string().describe('Run id directory name or LATEST.'),
        artifact: z
          .enum([
            'results.json',
            'summary.md',
            'trace.jsonl',
            'resolved-config.yaml',
            'report.html'
          ])
          .describe('Artifact filename to read.'),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Optional content truncation limit.'),
        line_start: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            '1-indexed line to start reading from (inclusive). Use with line_end to read a specific range.'
          ),
        line_end: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('1-indexed line to stop reading at (inclusive).')
      }
    },
    async ({ run_id, artifact, max_chars, line_start, line_end }) => {
      return withToolHandling(async () => {
        const base = resolveRunsDir();
        const readBase = resolveExistingRunReadDir(base, run_id === 'LATEST' ? undefined : run_id);
        const resolvedRunId = run_id === 'LATEST' ? latestRunId(readBase) : run_id;
        if (!resolvedRunId) {
          throw new Error(`No runs found in ${base}`);
        }
        const fullPath = resolveRunArtifactPath(readBase, resolvedRunId, artifact);
        if (!existsSync(fullPath)) {
          throw new Error(`Artifact not found: ${fullPath}`);
        }
        const raw = readFileSync(fullPath, 'utf8');
        let sliced = raw;
        let lineRangeNote: string | undefined;
        if (line_start !== undefined || line_end !== undefined) {
          const allLines = raw.split('\n');
          const from = Math.max(0, (line_start ?? 1) - 1);
          const to = line_end !== undefined ? Math.min(allLines.length, line_end) : allLines.length;
          sliced = allLines.slice(from, to).join('\n');
          lineRangeNote = `lines ${from + 1}–${to} of ${allLines.length}`;
        }
        const content = truncate(sliced, max_chars ?? 20_000);
        const structured: Record<string, unknown> = {
          path: fullPath,
          run_id: resolvedRunId,
          artifact,
          ...(lineRangeNote ? { line_range: lineRangeNote } : {}),
          truncated: content.length < sliced.length,
          content
        };
        if (artifact === 'results.json') {
          try {
            const parsed = normalizeResultsJson(JSON.parse(raw) as ResultsJson);
            structured.summary = parsed.summary;
            structured.metadata = parsed.metadata;
            structured.scenarios = parsed.scenarios.map((scenario) => ({
              scenario_id: scenario.scenario_id,
              agent: scenario.agent,
              pass_rate: scenario.pass_rate
            }));
          } catch {
            // Keep raw text if JSON parsing fails.
          }
        }
        return ok(`Read ${artifact} from run ${resolvedRunId}`, structured);
      });
    }
  );

  registerTool(
    'mcplab_results_index',
    {
      description:
        'Build or refresh local MCPLab results search index under mcplab/results/.index for LLM-first querying.',
      outputSchema: {
        runs_dir: z.string(),
        rebuilt: z.boolean(),
        doc_count: z.number().int().nonnegative(),
        index_path: z.string(),
        manifest_path: z.string()
      },
      inputSchema: {
        rebuild: z.boolean().optional().describe('Force full index rebuild.')
      }
    },
    async ({ rebuild }) => {
      return withToolHandling(async () => {
        const runsDir = resolveRunsDir();
        const wasStale = indexNeedsRefresh(runsDir);
        const docs = loadOrBuildSearchIndex(runsDir, Boolean(rebuild));
        const paths = getResultsIndexPaths(runsDir);
        return ok(`Results index ready (${docs.length} docs).`, {
          runs_dir: runsDir,
          rebuilt: Boolean(rebuild) || wasStale,
          doc_count: docs.length,
          index_path: paths.indexPath,
          manifest_path: paths.manifestPath
        });
      });
    }
  );

  registerTool(
    'mcplab_results_search',
    {
      description:
        'Search MCPLab run results in compact LLM-first format. Auto-refreshes index when artifacts changed.',
      outputSchema: {
        query: z.string(),
        runs_dir: z.string(),
        total_hits: z.number().int().nonnegative(),
        hits: z.array(
          z.object({
            run_id: z.string(),
            scenario_id: z.string().optional(),
            agent: z.string().optional(),
            status: z.enum(['passed', 'failed']).optional(),
            source: ResultsQuerySourceSchema,
            file: z.string(),
            line_start: z.number().int().positive().optional(),
            line_end: z.number().int().positive().optional(),
            snippet: z.string(),
            score: z.number(),
            context_command: z.string().optional()
          })
        )
      },
      inputSchema: {
        query: z.string().trim().min(1).describe('Search query.'),
        status: ResultsQueryStatusSchema.optional().describe('Filter by status (default all).'),
        source: z
          .array(ResultsQuerySourceSchema)
          .optional()
          .describe('Sources to search (default results,trace,summary).'),
        scenario: z.string().optional().describe('Filter by scenario id.'),
        agent: z.string().optional().describe('Filter by agent id.'),
        limit: z.number().int().positive().max(100).optional().describe('Max hits (default 10).')
      }
    },
    async ({ query, status, source, scenario, agent, limit }) => {
      return withToolHandling(async () => {
        const runsDir = resolveRunsDir();
        const docs = loadOrBuildSearchIndex(runsDir, false);
        const hits = searchDocs(docs, {
          query,
          status: status ?? 'all',
          source: source && source.length > 0 ? source : ['results', 'trace', 'summary'],
          scenario,
          agent,
          limit: limit ?? 10
        });
        return ok(`Found ${hits.length} result hit(s).`, {
          query,
          runs_dir: runsDir,
          total_hits: hits.length,
          hits
        });
      });
    }
  );

  registerTool(
    'mcplab_results_context',
    {
      description:
        'Fetch focused context for a scenario/run from results, trace, or summary. Returns bounded excerpts only. around is trace-line context and is only valid with source=trace (or when source is omitted).',
      outputSchema: {
        run_id: z.string(),
        scenario_id: z.string(),
        source: z.enum(['results', 'trace', 'summary', 'mixed']),
        line_start: z.number().int().positive().optional(),
        line_end: z.number().int().positive().optional(),
        excerpt: z.string()
      },
      inputSchema: {
        run_id: z.string().describe("Run id directory name or 'LATEST'."),
        scenario_id: z.string().describe('Scenario id to focus.'),
        source: ResultsQuerySourceSchema.optional().describe('Context source; default mixed.'),
        around: z.number().int().positive().optional().describe('Trace line center.'),
        before: z
          .number()
          .int()
          .min(0)
          .max(200)
          .optional()
          .describe('Lines before around for trace (default 20).'),
        after: z
          .number()
          .int()
          .min(0)
          .max(200)
          .optional()
          .describe('Lines after around for trace (default 20).')
      }
    },
    async ({ run_id, scenario_id, source, around, before, after }) => {
      return withToolHandling(async () => {
        const base = resolveRunsDir();
        const readBase = resolveExistingRunReadDir(base, run_id === 'LATEST' ? undefined : run_id);
        const resolvedRunId = run_id === 'LATEST' ? latestRunId(readBase) : run_id;
        if (!resolvedRunId) throw new Error(`No runs found in ${base}`);

        const result = getContext({
          runsDir: readBase,
          runId: resolvedRunId,
          scenarioId: scenario_id,
          source,
          around,
          before: before ?? 20,
          after: after ?? 20
        });
        return ok(`Loaded context for run ${resolvedRunId} scenario ${scenario_id}.`, {
          ...result
        });
      });
    }
  );
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'mcplab-scenario-author',
    {
      description:
        'Guide an LLM to author or refine MCPLab scenarios, prioritizing reusable scenario library files and deterministic eval rules.',
      argsSchema: {
        task: z.string().describe('What the scenario should test.'),
        server_ids: z
          .string()
          .optional()
          .describe('Comma-separated server ids to target if already known.'),
        agent_id: z.string().optional().describe('Optional pinned agent id.')
      }
    },
    async ({ task, server_ids, agent_id }) => {
      const maybeServers = server_ids
        ? `Target servers (if valid): ${server_ids}\n`
        : 'First inspect available servers with mcplab_list_library.\n';
      const maybeAgent = agent_id ? `Pinned agent (optional): ${agent_id}\n` : '';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Help me author a MCPLab scenario for this testing task:\n\n${task}\n\n` +
                `${maybeServers}${maybeAgent}` +
                `Workflow:\n` +
                `1. Inspect library entries (servers/agents/scenarios) if needed.\n` +
                `2. Draft a scenario with mcplab_generate_scenario_entry.\n` +
                `3. Suggest exact eval rules (required tools / regex assertions / extract rules).\n` +
                `4. Validate the final config with mcplab_validate_config when a config path is available.\n` +
                `Prefer reusable scenario files when possible.`
            }
          }
        ]
      };
    }
  );

  server.registerPrompt(
    'mcplab-config-author',
    {
      description:
        'Guide an LLM to build MCPLab config blocks (servers, agents, scenarios) and validate them incrementally.',
      argsSchema: {
        goal: z.string().describe('What should be evaluated and against which MCP server(s).'),
        config_path: z.string().optional().describe('Existing config path to update and validate.')
      }
    },
    async ({ goal, config_path }) => {
      const validationStep = config_path
        ? `Validate updates with mcplab_validate_config using config_path=${config_path}.`
        : `Ask for or choose a config path, then validate with mcplab_validate_config.`;
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Help me build/update a MCPLab evaluation config.\n\nGoal:\n${goal}\n\n` +
                `Use mcplab_generate_server_entry, mcplab_generate_agent_entry, and mcplab_generate_scenario_entry as needed.\n` +
                `Prioritize small deterministic changes and explicit YAML snippets.\n` +
                `${validationStep}`
            }
          }
        ]
      };
    }
  );
}

const DESTRUCTIVE_TOOLS = new Set<string>([
  'mcplab_delete_tool_analysis_result',
  'mcplab_write_markdown_report',
  'mcplab_run_eval'
]);
const MUTATING_TOOLS = new Set<string>(['mcplab_write_markdown_report', 'mcplab_run_eval']);
const OPEN_WORLD_TOOLS = new Set<string>(['mcplab_run_eval']);
const PREFERRED_TOOL_TITLES: Record<string, string> = {
  mcplab_write_markdown_report: 'Write Markdown Report to Disk',
  mcplab_search_markdown_reports: 'Search Markdown Reports',
  mcplab_list_library: 'Search Library Entries',
  mcplab_generate_agent_entry: 'Generate MCPLab agents.yaml Entry',
  mcplab_search_tool_analysis_results: 'Search Tool Analysis Results',
  mcplab_trace_search: 'Search Trace Events'
};

function normalizeOptionalNonEmpty(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveToolTitle(
  toolName: string,
  explicitTitle?: string,
  annotationTitle?: string
): string {
  return (
    normalizeOptionalNonEmpty(explicitTitle) ??
    normalizeOptionalNonEmpty(annotationTitle) ??
    PREFERRED_TOOL_TITLES[toolName] ??
    humanizeToolName(toolName)
  );
}

function inferToolAnnotations(
  toolName: string,
  resolvedTitle: string,
  override?: ToolAnnotationHints
): ToolAnnotationHints {
  const readOnly = !MUTATING_TOOLS.has(toolName) && !DESTRUCTIVE_TOOLS.has(toolName);
  const openWorld = OPEN_WORLD_TOOLS.has(toolName);
  const title = normalizeOptionalNonEmpty(override?.title) ?? resolvedTitle;
  const baseHints: ToolAnnotationHints = readOnly
    ? {
        title,
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: openWorld
      }
    : DESTRUCTIVE_TOOLS.has(toolName)
    ? {
        title,
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: openWorld
      }
    : {
        title,
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: openWorld
      };
  return {
    ...baseHints,
    ...override,
    title
  };
}

function humanizeToolName(toolName: string): string {
  const base = toolName.startsWith('mcplab_') ? toolName.slice('mcplab_'.length) : toolName;
  return base
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function resolveServerOwnedRoots(): ServerOwnedRoots {
  const cwd = process.cwd();
  const reportsDir = resolvePathInsideWorkspace(process.env.MCPLAB_REPORTS_DIR || 'mcplab/reports');
  const runsDir = resolvePathInsideWorkspace(
    process.env.MCPLAB_RUNS_DIR || 'mcplab/results/evaluation-runs'
  );
  const toolAnalysisDir = resolvePathInsideWorkspace(
    process.env.MCPLAB_TOOL_ANALYSIS_DIR || 'mcplab/results/tool-analysis'
  );
  const configuredBundleRoot = process.env.MCPLAB_BUNDLE_ROOT?.trim();
  if (configuredBundleRoot) {
    return {
      reportsDir,
      runsDir,
      toolAnalysisDir,
      bundleRoot: resolve(configuredBundleRoot)
    };
  }
  const candidates = ['mcplab', 'examples/libraries'];
  for (const candidate of candidates) {
    const abs = resolve(cwd, candidate);
    if (existsSync(abs)) {
      return { reportsDir, runsDir, toolAnalysisDir, bundleRoot: abs };
    }
  }
  return { reportsDir, runsDir, toolAnalysisDir, bundleRoot: resolve(cwd, 'mcplab') };
}

function resolveBundleRoot(): string {
  return SERVER_OWNED_ROOTS.bundleRoot;
}

function readLibrary(
  bundleRoot: string,
  includeContent: boolean
): z.infer<typeof LibraryEntrySchema> {
  const serversPath = join(bundleRoot, 'servers.yaml');
  const agentsPath = join(bundleRoot, 'agents.yaml');
  const scenariosDir = join(bundleRoot, 'scenarios');

  const servers = existsSync(serversPath)
    ? (parseYaml(readFileSync(serversPath, 'utf8')) as Record<string, unknown>) ?? {}
    : {};
  const agents = existsSync(agentsPath)
    ? (parseYaml(readFileSync(agentsPath, 'utf8')) as Record<string, unknown>) ?? {}
    : {};

  const scenarioEntries: z.infer<typeof LibraryScenarioEntrySchema>[] = [];
  if (existsSync(scenariosDir)) {
    const files = readdirSync(scenariosDir)
      .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
      .sort();
    for (const file of files) {
      const fullPath = join(scenariosDir, file);
      const raw = readFileSync(fullPath, 'utf8');
      const parsed = (parseYaml(raw) as Record<string, unknown> | null) ?? {};
      scenarioEntries.push(
        removeUndefined({
          file,
          id: typeof parsed.id === 'string' ? parsed.id : undefined,
          ...(includeContent ? { content: parsed, yaml: raw } : {})
        })
      );
    }
  }

  const out: z.infer<typeof LibraryEntrySchema> = {
    bundleRoot,
    servers: Object.keys(servers)
      .sort()
      .map((id) => ({
        id,
        ...(includeContent ? { entry: (servers[id] as Record<string, unknown>) ?? {} } : {})
      })),
    agents: Object.keys(agents)
      .sort()
      .map((id) => ({
        id,
        ...(includeContent ? { entry: agents[id] as z.infer<typeof AgentEntrySchema> } : {})
      })),
    scenarios: scenarioEntries
  };
  return out;
}

function getLibraryItem(
  bundleRoot: string,
  kind: 'servers' | 'agents' | 'scenarios',
  id: string
): Record<string, unknown> {
  if (kind === 'servers' || kind === 'agents') {
    const file = join(bundleRoot, `${kind}.yaml`);
    if (!existsSync(file)) {
      throw new Error(`Library file not found: ${file}`);
    }
    const raw = readFileSync(file, 'utf8');
    const parsed = (parseYaml(raw) as Record<string, unknown>) ?? {};
    if (!(id in parsed)) {
      throw new Error(`'${id}' not found in ${file}`);
    }
    const entry = parsed[id];
    return {
      bundleRoot,
      kind,
      id,
      yaml: stringifyYaml({ [id]: entry }).trimEnd(),
      content: entry as Record<string, unknown>
    };
  }

  const dir = join(bundleRoot, 'scenarios');
  if (!existsSync(dir)) {
    throw new Error(`Scenario library directory not found: ${dir}`);
  }
  const files = readdirSync(dir).filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'));
  for (const file of files) {
    const fullPath = join(dir, file);
    const raw = readFileSync(fullPath, 'utf8');
    const parsed = (parseYaml(raw) as Record<string, unknown> | null) ?? {};
    if (parsed.id === id) {
      return {
        bundleRoot,
        kind,
        id,
        file,
        yaml: raw.trimEnd(),
        content: parsed
      };
    }
  }
  throw new Error(`Scenario '${id}' not found in ${dir}`);
}

function buildServerEntry(input: {
  id: string;
  url: string;
  transport?: 'http';
  auth_type?: 'none' | 'bearer' | 'api_key' | 'oauth_client_credentials';
  bearer_token?: string;
  bearer_env?: string;
  api_key_header_name?: string;
  api_key_value?: string;
  oauth_token_url?: string;
  oauth_client_id_env?: string;
  oauth_client_secret_env?: string;
  oauth_scope?: string;
  oauth_audience?: string;
}): EvalConfig['servers'][string] {
  const transport = input.transport ?? 'http';
  const authType = input.auth_type ?? 'none';
  if (authType === 'none') {
    return { transport, url: input.url };
  }
  if (authType === 'bearer') {
    const token = input.bearer_token ?? (input.bearer_env ? `\${${input.bearer_env}}` : undefined);
    if (!token) {
      throw new Error('bearer_token or bearer_env is required when auth_type=bearer');
    }
    return {
      transport,
      url: input.url,
      auth: { type: 'bearer', token }
    };
  }
  if (authType === 'api_key') {
    if (!input.api_key_value) {
      throw new Error('api_key_value is required when auth_type=api_key');
    }
    return {
      transport,
      url: input.url,
      auth: removeUndefined({
        type: 'api_key',
        header_name: input.api_key_header_name,
        value: input.api_key_value
      }) as EvalConfig['servers'][string]['auth']
    };
  }
  if (!input.oauth_token_url || !input.oauth_client_id_env || !input.oauth_client_secret_env) {
    throw new Error(
      'oauth_token_url, oauth_client_id_env, and oauth_client_secret_env are required for oauth_client_credentials'
    );
  }
  return {
    transport,
    url: input.url,
    auth: removeUndefined({
      type: 'oauth_client_credentials',
      token_url: input.oauth_token_url,
      client_id_env: input.oauth_client_id_env,
      client_secret_env: input.oauth_client_secret_env,
      scope: input.oauth_scope,
      audience: input.oauth_audience
    }) as EvalConfig['servers'][string]['auth']
  };
}

function buildScenario(input: {
  id?: string;
  name?: string;
  agent?: string;
  servers: string[];
  prompt: string;
  snapshot_eval_enabled?: boolean;
  required_tools?: string[];
  forbidden_tools?: string[];
  allowed_tool_sequences?: string[][];
  response_regex_patterns?: string[];
  extract_rules?: Array<{ name: string; regex: string }>;
}): EvalConfig['scenarios'][number] {
  const id = input.id?.trim() || slugify(input.name?.trim() || input.prompt.slice(0, 40));
  if (!id) {
    throw new Error('Unable to derive scenario id. Provide id or name.');
  }

  const scenario: EvalConfig['scenarios'][number] = removeUndefined({
    id,
    agent: input.agent?.trim() || undefined,
    servers: input.servers,
    prompt: input.prompt,
    snapshot_eval_enabled: input.snapshot_eval_enabled,
    eval: buildEvalRules(input),
    extract: input.extract_rules?.map((rule) => ({
      name: rule.name,
      from: 'final_text',
      regex: rule.regex
    }))
  }) as EvalConfig['scenarios'][number];

  return scenario;
}

function buildEvalRules(input: {
  required_tools?: string[];
  forbidden_tools?: string[];
  allowed_tool_sequences?: string[][];
  response_regex_patterns?: string[];
}): EvalConfig['scenarios'][number]['eval'] | undefined {
  const toolConstraints =
    input.required_tools?.length || input.forbidden_tools?.length
      ? removeUndefined({
          required_tools: normalizeStringArray(input.required_tools),
          forbidden_tools: normalizeStringArray(input.forbidden_tools)
        })
      : undefined;
  const toolSequence =
    input.allowed_tool_sequences && input.allowed_tool_sequences.length > 0
      ? { allow: input.allowed_tool_sequences }
      : undefined;
  const responseAssertions =
    input.response_regex_patterns && input.response_regex_patterns.length > 0
      ? input.response_regex_patterns.map((pattern) => ({ type: 'regex' as const, pattern }))
      : undefined;
  const evalRules = removeUndefined({
    tool_constraints: toolConstraints,
    tool_sequence: toolSequence,
    response_assertions: responseAssertions
  }) as EvalConfig['scenarios'][number]['eval'];
  if (Object.keys(evalRules ?? {}).length === 0) {
    return undefined;
  }
  return evalRules;
}

function validateScenarioHeuristics(scenario: EvalConfig['scenarios'][number]): string[] {
  const warnings: string[] = [];
  if (!scenario.eval) {
    warnings.push(
      'No eval rules defined yet. Add required_tools and/or response assertions for deterministic checks.'
    );
  }
  if (!scenario.extract || scenario.extract.length === 0) {
    warnings.push('No extract rules defined. Consider adding domain metrics for trend tracking.');
  }
  if (scenario.prompt.trim().length < 40) {
    warnings.push(
      'Prompt is very short; scenario quality usually improves with explicit success criteria and output format instructions.'
    );
  }
  return warnings;
}

function summarizeConfig(config: EvalConfig): Record<string, unknown> {
  return {
    server_count: Object.keys(config.servers).length,
    agent_count: Object.keys(config.agents).length,
    scenario_count: config.scenarios.length,
    servers: Object.keys(config.servers).sort(),
    agents: Object.keys(config.agents).sort(),
    scenarios: config.scenarios.map((scenario) => ({
      id: scenario.id,
      servers: scenario.servers,
      has_eval: Boolean(scenario.eval),
      extract_count: scenario.extract?.length ?? 0
    }))
  };
}

function normalizeOptionalFilterSet(values?: string[]): Set<string> | null {
  if (!values || values.length === 0) return null;
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? new Set(normalized) : null;
}

function filterScenarios(
  scenarios: ResultsJson['scenarios'],
  scenarioFilter: Set<string> | null,
  agentFilter: Set<string> | null
): ResultsJson['scenarios'] {
  if (!scenarioFilter && !agentFilter) return scenarios;
  return scenarios.filter((scenario) => {
    const scenarioMatch = !scenarioFilter || scenarioFilter.has(scenario.scenario_id);
    const agentMatch = !agentFilter || agentFilter.has(scenario.agent);
    return scenarioMatch && agentMatch;
  });
}

function loadRunsForAnalysis(params: { runIds?: string[]; latestN: number }): LoadedRunResult[] {
  const base = resolveRunsDir();
  const ids = selectRunIdsForAnalysis(base, params.runIds, params.latestN);
  return ids.map((id) => loadSingleRunForAnalysis(base, id));
}

function loadSingleRunForAnalysis(primaryRunsDir: string, runIdInput: string): LoadedRunResult {
  const resolvedRunId = resolveRunIdToken(primaryRunsDir, runIdInput);
  const readBase = resolveExistingRunReadDir(primaryRunsDir, resolvedRunId);
  const runPath = resolve(readBase, resolvedRunId);
  const resultsPath = resolveRunArtifactPath(readBase, resolvedRunId, 'results.json');
  if (!existsSync(resultsPath)) {
    throw new Error(`results.json not found for run '${resolvedRunId}' at ${resultsPath}`);
  }
  const parsed = normalizeResultsJson(JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson);
  return {
    run_id: resolvedRunId,
    path: runPath,
    results: parsed
  };
}

function selectRunIdsForAnalysis(
  primaryRunsDir: string,
  runIds: string[] | undefined,
  latestN: number
): string[] {
  if (runIds && runIds.length > 0) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const token of runIds) {
      const resolved = resolveRunIdToken(primaryRunsDir, token);
      if (!seen.has(resolved)) {
        out.push(resolved);
        seen.add(resolved);
      }
    }
    return out;
  }
  const discovered = listRunsWithFallback(primaryRunsDir, latestN, false)
    .map((entry) => String(entry.run_id ?? '').trim())
    .filter(Boolean);
  if (discovered.length === 0) {
    throw new Error(`No runs found in ${primaryRunsDir}`);
  }
  return discovered;
}

function resolveRunIdToken(primaryRunsDir: string, runIdInput: string): string {
  const token = String(runIdInput ?? '').trim();
  if (!token) throw new Error('run id is required');
  if (token !== 'LATEST') return token;
  const latest = latestRunId(primaryRunsDir);
  if (!latest) {
    throw new Error(`No runs found in ${primaryRunsDir}`);
  }
  return latest;
}

function listRuns(
  runsDir: string,
  limit: number | undefined,
  includeSummary: boolean
): Array<Record<string, unknown>> {
  if (!existsSync(runsDir)) return [];
  const dirNames = readdirSync(runsDir)
    .filter((name) => {
      const full = join(runsDir, name);
      try {
        return statSync(full).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse();
  const cappedDirNames = typeof limit === 'number' ? dirNames.slice(0, limit) : dirNames;

  return cappedDirNames.map((runId) => {
    const out: Record<string, unknown> = {
      run_id: runId,
      path: join(runsDir, runId)
    };
    if (includeSummary) {
      const resultsPath = join(runsDir, runId, 'results.json');
      if (existsSync(resultsPath)) {
        try {
          const parsed = normalizeResultsJson(
            JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson
          );
          out.summary = parsed.summary;
          out.metadata = parsed.metadata;
        } catch (error) {
          out.summary_error = error instanceof Error ? error.message : String(error);
        }
      }
    }
    return out;
  });
}

function defaultRunsDirPath(): string {
  return SERVER_OWNED_ROOTS.runsDir;
}

function legacyRunsDirPath(): string {
  return resolvePathInsideWorkspace('mcplab/runs');
}

function resolveRunsDir(): string {
  return SERVER_OWNED_ROOTS.runsDir;
}

function runReadDirs(primaryRunsDir: string): string[] {
  const dirs = [primaryRunsDir];
  const defaultNew = defaultRunsDirPath();
  const legacy = legacyRunsDirPath();
  if (primaryRunsDir === defaultNew && legacy !== defaultNew) {
    dirs.push(legacy);
  }
  return Array.from(new Set(dirs));
}

function listRunsWithFallback(
  primaryRunsDir: string,
  limit: number | undefined,
  includeSummary: boolean
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  for (const dir of runReadDirs(primaryRunsDir)) {
    for (const entry of listRuns(dir, limit, includeSummary)) {
      const runId = String(entry.run_id ?? '');
      if (!runId || merged.has(runId)) continue;
      merged.set(runId, entry);
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => String(b.run_id ?? '').localeCompare(String(a.run_id ?? '')))
    .slice(0, typeof limit === 'number' ? limit : Number.MAX_SAFE_INTEGER);
}

function resolveExistingRunReadDir(primaryRunsDir: string, runId?: string): string {
  if (!runId) return primaryRunsDir;
  for (const dir of runReadDirs(primaryRunsDir)) {
    if (existsSync(join(dir, runId))) return dir;
  }
  return primaryRunsDir;
}

function expandConfigForAgents(
  config: EvalConfig,
  requestedAgents?: string[]
): ExecutableEvalConfig {
  const selectedAgents =
    requestedAgents && requestedAgents.length > 0 ? requestedAgents : Object.keys(config.agents);
  const missing = selectedAgents.filter((agent) => !config.agents[agent]);
  if (missing.length > 0) {
    throw new Error(
      `Unknown agents: ${missing.join(', ')}. Available: ${Object.keys(config.agents).join(', ')}`
    );
  }

  const scenarios = config.scenarios.flatMap((scenario) =>
    selectedAgents.map((agent) => ({
      ...scenario,
      agent,
      scenario_exec_id: `${scenario.id}-${agent}`
    }))
  );

  return { ...config, scenarios };
}

function latestRunId(runsDir: string): string | undefined {
  return listRunsWithFallback(runsDir, 1, false)[0]?.run_id as string | undefined;
}

function detectLikelyBundleRoot(configPath: string): string | null {
  const configDir = dirname(configPath);
  const candidateFromConfigs = dirname(configDir);
  if (
    existsSync(join(candidateFromConfigs, 'servers.yaml')) ||
    existsSync(join(candidateFromConfigs, 'scenarios'))
  ) {
    return candidateFromConfigs;
  }
  const fallback = resolveBundleRoot();
  return existsSync(fallback) ? fallback : null;
}

function resolveToolAnalysisResultsDir(): string {
  return SERVER_OWNED_ROOTS.toolAnalysisDir;
}

function resolveMarkdownReportsDir(): string {
  return SERVER_OWNED_ROOTS.reportsDir;
}

function isMarkdownReportExt(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === '.md' || ext === '.markdown';
}

function listMarkdownReportsFromDisk(root: string): MarkdownReportListItem[] {
  if (!existsSync(root)) return [];
  const items: MarkdownReportListItem[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !isMarkdownReportExt(fullPath)) continue;
      try {
        const st = statSync(fullPath);
        if (!st.isFile()) continue;
        items.push({
          path: relative(process.cwd(), fullPath).split(sep).join('/'),
          relativePath: relative(root, fullPath).split(sep).join('/'),
          name: basename(fullPath),
          sizeBytes: st.size,
          mtime: st.mtime.toISOString()
        });
      } catch {
        // Skip unreadable entries.
      }
    }
  };
  walk(root);
  items.sort((a, b) => {
    const aMtime = String(a.mtime ?? '');
    const bMtime = String(b.mtime ?? '');
    if (aMtime === bMtime) return String(a.path ?? '').localeCompare(String(b.path ?? ''));
    return bMtime.localeCompare(aMtime);
  });
  return items;
}

function resolveMarkdownReportPath(root: string, pathInput: string): string {
  const trimmed = pathInput.trim();
  if (!trimmed) throw new Error('path is required');
  const normalized = trimmed.replaceAll('/', sep);
  if (normalized === `mcplab${sep}reports` || normalized.startsWith(`mcplab${sep}reports${sep}`)) {
    throw new Error('path must be relative to reports root; do not prefix with mcplab/reports/');
  }
  const candidate = resolve(root, normalized);
  const withinRoot = candidate === root || candidate.startsWith(`${root}${sep}`);
  if (!withinRoot) throw new Error('path escapes markdown reports root');
  return candidate;
}

function legacyToolAnalysisResultsDir(): string {
  return resolvePathInsideWorkspace('mcplab/tool-analysis-results');
}

function toolAnalysisReadDirs(baseDir: string): string[] {
  const dirs = [baseDir];
  const defaultNew = resolvePathInsideWorkspace('mcplab/results/tool-analysis');
  const legacy = legacyToolAnalysisResultsDir();
  if (baseDir === defaultNew && legacy !== defaultNew) {
    dirs.push(legacy);
  }
  return Array.from(new Set(dirs));
}

function toolAnalysisReportDirPath(baseDir: string, reportId: string): string {
  const trimmed = reportId.trim();
  if (!trimmed) throw new Error('report_id is required');
  return resolvePathInsideWorkspace(join(baseDir, trimmed));
}

function toolAnalysisReportFilePath(baseDir: string, reportId: string): string {
  return resolvePathInsideWorkspace(
    join(toolAnalysisReportDirPath(baseDir, reportId), 'report.json')
  );
}

function latestToolAnalysisReportId(baseDir: string): string | undefined {
  if (!existsSync(baseDir)) return undefined;
  return readdirSync(baseDir)
    .filter((name) => {
      try {
        return statSync(join(baseDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse()[0];
}

function latestToolAnalysisReportIdWithFallback(baseDir: string): string | undefined {
  const ids = new Set<string>();
  for (const dir of toolAnalysisReadDirs(baseDir)) {
    const id = latestToolAnalysisReportId(dir);
    if (id) ids.add(id);
  }
  return Array.from(ids).sort().reverse()[0];
}

function parseToolAnalysisRecord(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid tool analysis report record');
  }
  return parsed as Record<string, unknown>;
}

function summarizeToolAnalysisRecord(record: Record<string, unknown>): Record<string, unknown> {
  const report = record.report;
  const reportObj =
    report && typeof report === 'object' && !Array.isArray(report)
      ? (report as Record<string, unknown>)
      : undefined;
  return removeUndefined({
    reportId: typeof record.reportId === 'string' ? record.reportId : undefined,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
    sourceJobId: typeof record.sourceJobId === 'string' ? record.sourceJobId : undefined,
    serverNames: Array.isArray(record.serverNames) ? record.serverNames : undefined,
    assistantAgentName:
      reportObj && typeof reportObj.assistantAgentName === 'string'
        ? reportObj.assistantAgentName
        : undefined,
    assistantAgentModel:
      reportObj && typeof reportObj.assistantAgentModel === 'string'
        ? reportObj.assistantAgentModel
        : undefined,
    modes:
      reportObj && typeof reportObj.modes === 'object' && !Array.isArray(reportObj.modes)
        ? reportObj.modes
        : undefined,
    summary:
      reportObj && typeof reportObj.summary === 'object' && !Array.isArray(reportObj.summary)
        ? reportObj.summary
        : undefined
  });
}

function listToolAnalysisReportsFromDisk(
  baseDir: string,
  limit: number | undefined
): Array<Record<string, unknown>> {
  if (!existsSync(baseDir)) return [];
  const ids = readdirSync(baseDir)
    .filter((name) => {
      try {
        return statSync(join(baseDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse();
  const cappedIds = typeof limit === 'number' ? ids.slice(0, limit) : ids;
  const out: Array<Record<string, unknown>> = [];
  for (const reportId of cappedIds) {
    try {
      const filePath = toolAnalysisReportFilePath(baseDir, reportId);
      if (!existsSync(filePath)) continue;
      const parsed = parseToolAnalysisRecord(readFileSync(filePath, 'utf8'));
      out.push(
        removeUndefined({
          report_id: reportId,
          path: toolAnalysisReportDirPath(baseDir, reportId),
          ...summarizeToolAnalysisRecord(parsed)
        })
      );
    } catch (error) {
      out.push({
        report_id: reportId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return out;
}

function listToolAnalysisReportsFromDiskWithFallback(
  baseDir: string,
  limit: number | undefined
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  for (const dir of toolAnalysisReadDirs(baseDir)) {
    for (const item of listToolAnalysisReportsFromDisk(dir, limit)) {
      const reportId = typeof item.report_id === 'string' ? item.report_id : '';
      if (!reportId || merged.has(reportId)) continue;
      merged.set(reportId, item);
    }
  }
  return Array.from(merged.values())
    .sort((a, b) => String(b.report_id ?? '').localeCompare(String(a.report_id ?? '')))
    .slice(0, typeof limit === 'number' ? limit : Number.MAX_SAFE_INTEGER);
}

function toolAnalysisReportDirPathWithFallback(baseDir: string, reportId: string): string {
  for (const dir of toolAnalysisReadDirs(baseDir)) {
    const candidate = toolAnalysisReportDirPath(dir, reportId);
    if (existsSync(candidate)) return candidate;
  }
  return toolAnalysisReportDirPath(baseDir, reportId);
}

function toolAnalysisReportFilePathWithFallback(baseDir: string, reportId: string): string {
  for (const dir of toolAnalysisReadDirs(baseDir)) {
    const candidate = toolAnalysisReportFilePath(dir, reportId);
    if (existsSync(candidate)) return candidate;
  }
  return toolAnalysisReportFilePath(baseDir, reportId);
}

type ReadScenarioRunTraceResult = {
  runId: string;
  tracePath: string;
  records: ScenarioRunTraceRecord[];
  legacyDetected: boolean;
};

function isTraceMessage(value: unknown): value is TraceMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.role !== 'user' && v.role !== 'assistant' && v.role !== 'tool') return false;
  if (!Array.isArray(v.content)) return false;
  return true;
}

function isScenarioRunTraceRecord(value: unknown): value is ScenarioRunTraceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'scenario_run' &&
    v.trace_version === 3 &&
    typeof v.scenario_id === 'string' &&
    typeof v.agent === 'string' &&
    typeof v.provider === 'string' &&
    typeof v.model === 'string' &&
    typeof v.ts_start === 'string' &&
    typeof v.ts_end === 'string' &&
    typeof v.pass === 'boolean' &&
    Array.isArray(v.messages) &&
    v.messages.every(isTraceMessage)
  );
}

function readScenarioRunTraceRecordsForRun(runIdInput: string): ReadScenarioRunTraceResult {
  const base = resolveRunsDir();
  const readBase = resolveExistingRunReadDir(
    base,
    runIdInput === 'LATEST' ? undefined : runIdInput
  );
  const runId = runIdInput === 'LATEST' ? latestRunId(readBase) : runIdInput;
  if (!runId) throw new Error(`No runs found in ${base}`);
  const tracePath = resolveRunArtifactPath(readBase, runId, 'trace.jsonl');
  if (!existsSync(tracePath)) throw new Error(`Artifact not found: ${tracePath}`);
  const raw = readFileSync(tracePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const records: ScenarioRunTraceRecord[] = [];
  let legacyDetected = false;
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isScenarioRunTraceRecord(parsed)) {
      records.push(parsed);
      continue;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const p = parsed as Record<string, unknown>;
      if (typeof p.type === 'string' && p.type !== 'trace_meta') {
        legacyDetected = true;
      }
    }
  }
  return { runId, tracePath, records, legacyDetected };
}

function flattenScenarioRunTraceRecords(
  records: ScenarioRunTraceRecord[]
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const [recordIndex, record] of records.entries()) {
    for (const [messageIndex, message] of record.messages.entries()) {
      out.push(
        removeUndefined({
          type: 'message',
          record_index: recordIndex,
          message_index: messageIndex,
          scenario_id: record.scenario_id,
          agent: record.agent,
          role: message.role,
          ts: message.ts,
          usage: message.usage
        })
      );
      for (const [blockIndex, block] of message.content.entries()) {
        if (block.type === 'text') {
          out.push({
            type: 'text',
            record_index: recordIndex,
            message_index: messageIndex,
            block_index: blockIndex,
            scenario_id: record.scenario_id,
            agent: record.agent,
            role: message.role,
            ts: message.ts,
            text: block.text
          });
          continue;
        }
        if (block.type === 'tool_use') {
          out.push({
            type: 'tool_use',
            record_index: recordIndex,
            message_index: messageIndex,
            block_index: blockIndex,
            scenario_id: record.scenario_id,
            agent: record.agent,
            role: message.role,
            ts: message.ts,
            id: block.id,
            name: block.name,
            server: block.server,
            input: block.input
          });
          continue;
        }
        out.push(
          removeUndefined({
            type: 'tool_result',
            record_index: recordIndex,
            message_index: messageIndex,
            block_index: blockIndex,
            scenario_id: record.scenario_id,
            agent: record.agent,
            role: message.role,
            ts: block.ts_end ?? block.ts_start ?? message.ts,
            tool_use_id: block.tool_use_id,
            name: block.name,
            server: block.server,
            is_error: block.is_error,
            duration_ms: block.duration_ms,
            content: block.content
          })
        );
      }
    }
  }
  return out;
}

function extractTextBlocks(blocks: TraceMessageContentBlock[]): string[] {
  return blocks
    .filter((b): b is Extract<TraceMessageContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text);
}

function extractFinalAssistantText(record: ScenarioRunTraceRecord): string {
  for (let i = record.messages.length - 1; i >= 0; i -= 1) {
    const message = record.messages[i];
    if (message.role !== 'assistant') continue;
    const text = extractTextBlocks(message.content).join('\n\n').trim();
    if (text) return text;
  }
  return '';
}

function buildConversationTimeline(
  record: ScenarioRunTraceRecord,
  textMax: number
): Array<Record<string, unknown>> {
  const timeline: Array<Record<string, unknown>> = [];
  for (const [messageIndex, message] of record.messages.entries()) {
    for (const [blockIndex, block] of message.content.entries()) {
      if (block.type === 'text') {
        timeline.push({
          index: timeline.length,
          type:
            message.role === 'assistant'
              ? 'agent_message'
              : message.role === 'user'
              ? 'user_message'
              : 'tool_text',
          role: message.role,
          ts: message.ts,
          message_index: messageIndex,
          block_index: blockIndex,
          text: truncate(block.text, textMax)
        });
        continue;
      }
      if (block.type === 'tool_use') {
        timeline.push({
          index: timeline.length,
          type: 'tool_call',
          role: message.role,
          ts: message.ts,
          message_index: messageIndex,
          block_index: blockIndex,
          id: block.id,
          server: block.server,
          tool: block.name,
          args: block.input
        });
        continue;
      }
      timeline.push({
        index: timeline.length,
        type: 'tool_result',
        role: message.role,
        ts: block.ts_end ?? block.ts_start ?? message.ts,
        message_index: messageIndex,
        block_index: blockIndex,
        tool_use_id: block.tool_use_id,
        server: block.server,
        tool: block.name,
        ok: !block.is_error,
        duration_ms: block.duration_ms,
        content: block.content.map((c) => ({ ...c, text: truncate(c.text, textMax) }))
      });
    }
  }
  return timeline;
}

function resolvePathInsideWorkspace(pathInput: string): string {
  const workspaceRoot = resolve(process.cwd());
  const target = resolve(workspaceRoot, pathInput);
  const withinWorkspace = target === workspaceRoot || target.startsWith(`${workspaceRoot}${sep}`);
  if (!withinWorkspace) {
    throw new Error(`Path escapes workspace root: ${pathInput}`);
  }
  return target;
}

function validateWorkspaceRelativePath(value: string, fieldName: string): void {
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`${fieldName} must be relative (absolute paths are not allowed)`);
  }
  if (value.split(/[\\/]/).some((part) => part === '..')) {
    throw new Error(`${fieldName} must not contain ".." path segments`);
  }
}

function ok(summary: string, structuredContent?: Record<string, unknown>): ToolResult {
  const payload = structuredContent ?? {};
  return {
    content: [
      {
        type: 'text',
        text: `${summary}\n\n${JSON.stringify(payload, null, 2)}`
      }
    ],
    structuredContent: payload
  };
}

function err(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${message}` }]
  };
}

async function withToolHandling(fn: () => Promise<ToolResult> | ToolResult): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    return err(error);
  }
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function searchableText(value: unknown): string {
  const tokens: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (trimmed) tokens.push(trimmed.toLowerCase());
      return;
    }
    if (typeof node === 'number' || typeof node === 'boolean') {
      tokens.push(String(node).toLowerCase());
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === 'object') {
      for (const entryValue of Object.values(node as Record<string, unknown>)) {
        visit(entryValue);
      }
    }
  };
  visit(value);
  return tokens.join(' ');
}

function normalizeStringArray(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  const out = values.map((value) => value.trim()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function indentBlock(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

export async function handleMcplabMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, SessionRuntime>,
  options?: { path?: string }
): Promise<void> {
  await handleHttpRequest(req, res, sessions, options?.path ?? DEFAULT_MCP_PATH);
}

async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, SessionRuntime>,
  mcpPath: string
): Promise<void> {
  const method = req.method ?? 'GET';
  const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

  if (pathname === '/' && method === 'GET') {
    sendJson(res, 200, {
      name: 'mcplab-assistant-server',
      version: SERVER_VERSION,
      transport: 'streamable-http',
      mcp_endpoint: mcpPath
    });
    return;
  }

  if (pathname !== mcpPath) {
    sendPlain(res, 404, 'Not Found');
    return;
  }

  if (method === 'POST') {
    const body = await readJsonBody(req);
    const sessionId = getSessionId(req);
    if (sessionId && sessions.has(sessionId)) {
      const runtime = sessions.get(sessionId)!;
      await runtime.transport.handleRequest(req, res, body);
      return;
    }

    if (!sessionId && isInitializeRequest(body)) {
      let runtime!: SessionRuntime;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, runtime);
        },
        onsessionclosed: (sid) => {
          sessions.delete(sid);
        }
      });
      const mcpServer = createConfiguredServer();
      runtime = { transport, server: mcpServer };
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    sendJson(res, 400, {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: missing/invalid MCP session or initialize request'
      },
      id: null
    });
    return;
  }

  if (method === 'GET' || method === 'DELETE') {
    const sessionId = getSessionId(req);
    if (!sessionId || !sessions.has(sessionId)) {
      sendPlain(res, 400, 'Invalid or missing session ID');
      return;
    }
    const runtime = sessions.get(sessionId)!;
    await runtime.transport.handleRequest(req, res);
    if (method === 'DELETE') {
      sessions.delete(sessionId);
      try {
        await runtime.server.close();
      } catch {
        // Transport already handled protocol delete; ignore close errors.
      }
    }
    return;
  }

  sendPlain(res, 405, 'Method Not Allowed');
}

function getSessionId(req: IncomingMessage): string | undefined {
  const header = req.headers['mcp-session-id'];
  if (Array.isArray(header)) return header[0];
  return header;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json');
  res.end(`${JSON.stringify(payload)}\n`);
}

function sendPlain(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(body);
}
