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
  chatWithAgent,
  loadConfig,
  runAll,
  selectScenarios,
  type AgentConfig,
  type EvalConfig,
  type ExecutableEvalConfig,
  type ResultsJson,
  type ScenarioRunTraceRecord,
  type TraceMessage,
  type TraceMessageContentBlock
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

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

type AggregateGroupBy = 'run' | 'scenario' | 'agent';

type MetricSummary = {
  total_runs: number;
  passed_runs: number;
  failed_runs: number;
  pass_rate: number;
  avg_tool_calls_per_run: number;
  avg_tool_latency_ms: number | null;
};

type LoadedRunResult = {
  run_id: string;
  path: string;
  results: ResultsJson;
};

type AggregateGroupRow = MetricSummary & {
  key: string;
  run_id?: string;
  scenario_id?: string;
  agent?: string;
  run_count: number;
  timestamp_range?: {
    min: string;
    max: string;
  };
};

type CompareClass = 'regressed' | 'improved' | 'unchanged' | 'new' | 'missing';

type CompareRow = {
  key: string;
  scenario_id: string;
  agent: string;
  classification: CompareClass;
  left: MetricSummary | null;
  right: MetricSummary | null;
  deltas: {
    pass_rate: number | null;
    failed_runs: number | null;
    avg_tool_calls_per_run: number | null;
    avg_tool_latency_ms: number | null;
  };
};

type QualityDimension = 'factuality' | 'completeness' | 'actionability' | 'clarity';

type QualityScoreSet = Record<QualityDimension, number>;

type QualityJudgeResponse = {
  answer_a: {
    dimension_scores: QualityScoreSet;
    overall_score: number;
  };
  answer_b: {
    dimension_scores: QualityScoreSet;
    overall_score: number;
  };
  confidence: number;
  rationale: string;
};

type QualityCompareClass = 'regressed' | 'improved' | 'unchanged' | 'new' | 'missing';

type QualityCompareRow = {
  key: string;
  scenario_id: string;
  agent: string;
  classification: QualityCompareClass;
  left: { dimension_scores: QualityScoreSet; overall_score: number } | null;
  right: { dimension_scores: QualityScoreSet; overall_score: number } | null;
  deltas: {
    overall_score: number | null;
    dimension_scores: Record<QualityDimension, number | null>;
  };
  confidence: number | null;
  rationale?: string;
  judge_error?: string;
};

const DEFAULT_MCP_PATH = '/mcp';
const DEFAULT_MCP_PORT = 3011;
const DEFAULT_MCP_HOST = '127.0.0.1';
const MAX_MARKDOWN_REPORT_READ_BYTES = 2 * 1024 * 1024;

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
    server.registerTool(
      name,
      {
        ...config,
        title: resolvedTitle,
        annotations: inferToolAnnotations(name, resolvedTitle, config.annotations)
      },
      cb as never
    );
  };

  registerTool(
    'mcplab_write_markdown_report',
    {
      description:
        'Write a Markdown report file to disk (for example under mcplab/reports/) and return the resolved path. Paths must stay inside the current workspace.',
      inputSchema: {
        output_path: z
          .string()
          .describe(
            'Target .md/.markdown path, relative to the current workspace or absolute within it.'
          ),
        markdown: z.string().describe('Markdown content to write.'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Overwrite existing file if true. Defaults to false.'),
        create_dirs: z
          .boolean()
          .optional()
          .describe('Create missing parent directories if true. Defaults to true.')
      }
    },
    async ({ output_path, markdown, overwrite, create_dirs }) => {
      return withToolHandling(async () => {
        const targetPath = resolvePathInsideWorkspace(output_path);
        const extension = extname(targetPath).toLowerCase();
        if (extension !== '.md' && extension !== '.markdown') {
          throw new Error('output_path must end with .md or .markdown');
        }
        const parentDir = dirname(targetPath);
        if (Boolean(create_dirs ?? true)) {
          mkdirSync(parentDir, { recursive: true });
        } else if (!existsSync(parentDir)) {
          throw new Error(`Parent directory does not exist: ${parentDir}`);
        }
        const fileExists = existsSync(targetPath);
        if (fileExists && !Boolean(overwrite)) {
          throw new Error(`File already exists: ${targetPath} (set overwrite=true to replace it)`);
        }
        const normalized = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
        writeFileSync(targetPath, normalized, 'utf8');
        return ok(`Wrote Markdown report to ${targetPath}`, {
          path: targetPath,
          bytes: Buffer.byteLength(normalized, 'utf8'),
          chars: normalized.length,
          overwritten: fileExists,
          workspace_root: process.cwd()
        });
      });
    }
  );

  registerTool(
    'mcplab_list_markdown_reports',
    {
      description:
        'List saved markdown reports under mcplab/reports. Supports filtering by run id substring to find reports linked to a result.',
      inputSchema: {
        reports_dir: z
          .string()
          .optional()
          .describe('Markdown reports root (default mcplab/reports).'),
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
          .optional()
          .describe('Max reports to return (default 20).')
      }
    },
    async ({ reports_dir, run_id, query, limit }) => {
      return withToolHandling(async () => {
        const root = resolveMarkdownReportsDir(reports_dir);
        const all = listMarkdownReportsFromDisk(root);
        const runFilter = String(run_id ?? '').trim();
        const searchQuery = String(query ?? '').trim().toLowerCase();
        const filtered = all.filter((item) => {
          if (runFilter && !item.relativePath.includes(runFilter) && !item.name.includes(runFilter)) {
            return false;
          }
          if (!searchQuery) return true;
          const hay = `${item.path}\n${item.relativePath}\n${item.name}`.toLowerCase();
          return hay.includes(searchQuery);
        });
        const capped = filtered.slice(0, limit ?? 20);
        return ok(`Found ${capped.length}/${filtered.length} markdown report(s) in ${root}`, {
          reports_dir: root,
          run_id_filter: runFilter || undefined,
          query: searchQuery || undefined,
          total_matching: filtered.length,
          items: capped
        });
      });
    }
  );

  registerTool(
    'mcplab_search_markdown_reports',
    {
      description:
        'Search markdown reports by query text and optional run id filter; optimized for discovery workflows.',
      inputSchema: {
        query: z
          .string()
          .describe('Case-insensitive search query across report path/name fields.'),
        reports_dir: z
          .string()
          .optional()
          .describe('Markdown reports root (default mcplab/reports).'),
        run_id: z
          .string()
          .optional()
          .describe('Optional run id substring filter (matches path/name).'),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe('Max reports to return (default 20).')
      }
    },
    async ({ query, reports_dir, run_id, limit }) => {
      return withToolHandling(async () => {
        const root = resolveMarkdownReportsDir(reports_dir);
        const all = listMarkdownReportsFromDisk(root);
        const runFilter = String(run_id ?? '').trim();
        const searchQuery = String(query ?? '').trim().toLowerCase();
        if (!searchQuery) throw new Error('query is required');
        const filtered = all.filter((item) => {
          if (runFilter && !item.relativePath.includes(runFilter) && !item.name.includes(runFilter)) {
            return false;
          }
          const hay = `${item.path}\n${item.relativePath}\n${item.name}`.toLowerCase();
          return hay.includes(searchQuery);
        });
        const capped = filtered.slice(0, limit ?? 20);
        return ok(`Found ${capped.length}/${filtered.length} markdown report(s) in ${root}`, {
          reports_dir: root,
          run_id_filter: runFilter || undefined,
          query: searchQuery,
          total_matching: filtered.length,
          items: capped
        });
      });
    }
  );

  registerTool(
    'mcplab_read_markdown_report',
    {
      description:
        'Read a saved markdown report by relative path (under mcplab/reports by default) or by workspace-relative path, with optional truncation.',
      inputSchema: {
        path: z
          .string()
          .describe(
            'Report path (relative to reports root or workspace-relative, e.g. mcplab/reports/... ).'
          ),
        reports_dir: z
          .string()
          .optional()
          .describe('Markdown reports root (default mcplab/reports).'),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Optional truncation for markdown content preview (default 20000).')
      }
    },
    async ({ path, reports_dir, max_chars }) => {
      return withToolHandling(async () => {
        const root = resolveMarkdownReportsDir(reports_dir);
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
      inputSchema: {
        bundleRoot: z
          .string()
          .optional()
          .describe(
            'Optional library bundle root. Defaults to mcplab/ or examples/libraries/ if present.'
          ),
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
    async ({ bundleRoot, kind, includeContent }) => {
      return withToolHandling(async () => {
        const root = resolveBundleRoot(bundleRoot);
        const data = readLibrary(root, Boolean(includeContent));
        const selectedKind = kind ?? 'all';
        const structured =
          selectedKind === 'all'
            ? data
            : {
                bundleRoot: data.bundleRoot,
                [selectedKind]: data[selectedKind]
              };

        return ok(`Loaded MCPLab library from ${root}`, structured as Record<string, unknown>);
      });
    }
  );

  registerTool(
    'mcplab_get_library_item',
    {
      description:
        'Get a specific reusable server, agent, or scenario definition from a MCPLab library bundle and return both structured data and YAML.',
      inputSchema: {
        bundleRoot: z.string().optional().describe('Optional library bundle root path.'),
        kind: z.enum(['servers', 'agents', 'scenarios']).describe('Library category.'),
        id: z.string().describe('Entry id (for scenarios this is scenario.id, not filename).')
      }
    },
    async ({ bundleRoot, kind, id }) => {
      return withToolHandling(async () => {
        const root = resolveBundleRoot(bundleRoot);
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
      inputSchema: z
        .object({
          id: z.string().describe('Server id key (kebab-case recommended).'),
          url: z.string().describe('MCP server URL (Streamable HTTP endpoint).'),
          transport: z
            .enum(['http'])
            .optional()
            .describe('MCPLab transport type (currently http).'),
          auth_type: z
            .enum(['none', 'bearer', 'api_key', 'oauth_client_credentials'])
            .optional()
            .describe('Authentication mode.'),
          bearer_token: z
            .string()
            .optional()
            .describe('Direct bearer token value or ${VAR} env reference when auth_type=bearer.'),
          bearer_env: z
            .string()
            .optional()
            .describe('Env var for bearer token when auth_type=bearer.'),
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
        })
        .superRefine((value, ctx) => {
          const authType = value.auth_type ?? 'none';
          if (authType === 'bearer') {
            if (!value.bearer_token && !value.bearer_env) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                  'auth_type=bearer requires at least one of bearer_token or bearer_env.'
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
        })
    },
    async (input) => {
      return withToolHandling(async () => {
        const entry = buildServerEntry(input);
        return ok(`Generated server entry '${input.id}'`, {
          id: input.id,
          entry,
          yaml: stringifyYaml({ [input.id]: entry }).trimEnd()
        });
      });
    }
  );

  registerTool(
    'mcplab_generate_agent_entry',
    {
      description:
        'Generate a MCPLab agents.yaml entry (provider/model/system settings) for evaluation runs.',
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
        prompt: z.string().describe('The task prompt the evaluation agent should execute.'),
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
      inputSchema: {
        config_path: z.string().describe('Path to MCPLab eval YAML config.'),
        bundle_root: z
          .string()
          .optional()
          .describe('Optional bundle root override for refs resolution.'),
        scenario_id: z
          .string()
          .optional()
          .describe('Optional single scenario id to validate selection.')
      }
    },
    async ({ config_path, bundle_root, scenario_id }) => {
      return withToolHandling(async () => {
        const loaded = loadConfig(resolve(config_path), {
          bundleRoot: bundle_root ? resolve(bundle_root) : undefined
        });
        const selected = selectScenarios(loaded.config, scenario_id);
        const summary = summarizeConfig(selected);
        return ok(`Validated config ${config_path}`, {
          configPath: resolve(config_path),
          bundleRoot: bundle_root
            ? resolve(bundle_root)
            : detectLikelyBundleRoot(resolve(config_path)),
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
        duration_ms: z.number().nonnegative().nullable(),
        summary: z.record(z.unknown()),
        metadata: z.record(z.unknown()),
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
        bundle_root: z
          .string()
          .optional()
          .describe('Optional bundle root override for library refs.'),
        scenario_id: z.string().optional().describe('Optional scenario id to run.'),
        runs_per_scenario: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Runs per scenario (default 1).'),
        runs_dir: z
          .string()
          .optional()
          .describe('Output directory for run artifacts (default mcplab/results/evaluation-runs).')
      }
    },
    async ({ config_path, bundle_root, scenario_id, runs_per_scenario, runs_dir }) => {
      return withToolHandling(async () => {
        const loaded = loadConfig(resolve(config_path), {
          bundleRoot: bundle_root ? resolve(bundle_root) : undefined
        });
        const selected = selectScenarios(loaded.config, scenario_id);
        const executable = expandConfigForAgents(selected, selected.run_defaults?.selected_agents);
        const { runDir, results } = await runAll(executable, {
          runsPerScenario: runs_per_scenario ?? 1,
          scenarioId: scenario_id,
          configHash: loaded.hash,
          cliVersion: `mcplab-mcp-server/${SERVER_VERSION}`,
          runsDir: runs_dir ?? 'mcplab/results/evaluation-runs'
        });

        const reportHtml = renderReport(results);
        const allRuns = results.scenarios.flatMap((scenario) => scenario.runs);
        const passedRuns = allRuns.filter((run) => run.pass === true).length;
        const failedRuns = allRuns.filter((run) => run.pass === false).length;
        return ok(`MCPLab run completed: ${runDir}`, {
          run_dir: runDir,
          total_scenarios: results.summary.total_scenarios,
          total_runs: results.summary.total_runs,
          passed_runs: passedRuns,
          failed_runs: failedRuns,
          skipped_runs: 0,
          duration_ms: null,
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
    'mcplab_list_runs',
    {
      description:
        'List MCPLab run artifact directories and optionally summarize each run from results.json when present.',
      inputSchema: {
        runs_dir: z
          .string()
          .optional()
          .describe('Runs directory (default mcplab/results/evaluation-runs).'),
        query: z
          .string()
          .optional()
          .describe('Optional case-insensitive search query across run id/path (and summary fields when include_summary=true).'),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe('Max runs to return (default 10).'),
        include_summary: z
          .boolean()
          .optional()
          .describe('Read results.json summary for each run when available.')
      }
    },
    async ({ runs_dir, query, limit, include_summary }) => {
      return withToolHandling(async () => {
        const base = resolveRunsDir(runs_dir);
        const entries = listRunsWithFallback(base, limit ?? 10, Boolean(include_summary));
        const searchQuery = String(query ?? '').trim().toLowerCase();
        const filtered = searchQuery
          ? entries.filter((entry) => JSON.stringify(entry).toLowerCase().includes(searchQuery))
          : entries;
        return ok(`Found ${filtered.length} run(s) in ${base}`, {
          runsDir: base,
          query: searchQuery || undefined,
          total_matching: filtered.length,
          runs: filtered
        });
      });
    }
  );

  registerTool(
    'mcplab_search_runs',
    {
      description:
        'Search MCPLab run artifacts with a text query across run metadata and paths.',
      inputSchema: {
        query: z
          .string()
          .describe('Case-insensitive search query across run id/path and summary fields.'),
        runs_dir: z
          .string()
          .optional()
          .describe('Runs directory (default mcplab/results/evaluation-runs).'),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe('Max runs to return (default 10).'),
        include_summary: z
          .boolean()
          .optional()
          .describe('Read results.json summary for each run when available (default true).')
      }
    },
    async ({ query, runs_dir, limit, include_summary }) => {
      return withToolHandling(async () => {
        const base = resolveRunsDir(runs_dir);
        const searchQuery = String(query ?? '').trim().toLowerCase();
        if (!searchQuery) throw new Error('query is required');
        const entries = listRunsWithFallback(base, limit ?? 10, include_summary ?? true);
        const filtered = entries.filter((entry) =>
          JSON.stringify(entry).toLowerCase().includes(searchQuery)
        );
        return ok(`Found ${filtered.length} run(s) in ${base}`, {
          runsDir: base,
          query: searchQuery,
          total_matching: filtered.length,
          runs: filtered
        });
      });
    }
  );

  registerTool(
    'mcplab_aggregate_runs',
    {
      description:
        'Aggregate metrics across historical MCPLab runs with compact summary-first output.',
      inputSchema: {
        runs_dir: z
          .string()
          .optional()
          .describe('Runs directory (default mcplab/results/evaluation-runs).'),
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
    async ({
      runs_dir,
      run_ids,
      latest_n,
      scenario_ids,
      agents,
      group_by,
      top_n,
      include_details
    }) => {
      return withToolHandling(async () => {
        const loaded = loadRunsForAnalysis({
          runsDirInput: runs_dir,
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
      inputSchema: {
        runs_dir: z
          .string()
          .optional()
          .describe('Runs directory (default mcplab/results/evaluation-runs).'),
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
    async ({
      runs_dir,
      left_run_id,
      right_run_id,
      scenario_ids,
      agents,
      top_n,
      include_details
    }) => {
      return withToolHandling(async () => {
        const base = resolveRunsDir(runs_dir);
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
    'mcplab_list_tool_analysis_results',
    {
      description:
        'List saved MCP tool analysis reports persisted by the MCPLab app (default: mcplab/results/tool-analysis).',
      outputSchema: {
        tool_analysis_results_dir: z.string(),
        total: z.number().int().nonnegative(),
        items: z.array(z.record(z.unknown()))
      },
      inputSchema: {
        tool_analysis_results_dir: z
          .string()
          .optional()
          .describe('Directory containing saved tool analysis report folders.'),
        query: z
          .string()
          .optional()
          .describe('Optional case-insensitive search query across report id/path/summary metadata.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe('Max reports to return (default 20).')
      }
    },
    async ({ tool_analysis_results_dir, query, limit }) => {
      return withToolHandling(async () => {
        const baseDir = resolveToolAnalysisResultsDir(tool_analysis_results_dir);
        const reports = listToolAnalysisReportsFromDiskWithFallback(baseDir, limit ?? 20);
        const searchQuery = String(query ?? '').trim().toLowerCase();
        const filtered = searchQuery
          ? reports.filter((report) => JSON.stringify(report).toLowerCase().includes(searchQuery))
          : reports;
        return ok(`Found ${filtered.length} tool analysis report(s) in ${baseDir}`, {
          tool_analysis_results_dir: baseDir,
          query: searchQuery || undefined,
          total: filtered.length,
          items: filtered
        });
      });
    }
  );

  registerTool(
    'mcplab_search_tool_analysis_results',
    {
      description:
        'Search saved MCP tool analysis reports by query text across ids, paths, and summary fields.',
      inputSchema: {
        query: z
          .string()
          .describe('Case-insensitive search query across report id/path/summary fields.'),
        tool_analysis_results_dir: z
          .string()
          .optional()
          .describe('Directory containing saved tool analysis report folders.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe('Max reports to return (default 20).')
      }
    },
    async ({ query, tool_analysis_results_dir, limit }) => {
      return withToolHandling(async () => {
        const baseDir = resolveToolAnalysisResultsDir(tool_analysis_results_dir);
        const searchQuery = String(query ?? '').trim().toLowerCase();
        if (!searchQuery) throw new Error('query is required');
        const reports = listToolAnalysisReportsFromDiskWithFallback(baseDir, limit ?? 20);
        const filtered = reports.filter((report) =>
          JSON.stringify(report).toLowerCase().includes(searchQuery)
        );
        return ok(`Found ${filtered.length} tool analysis report(s) in ${baseDir}`, {
          tool_analysis_results_dir: baseDir,
          query: searchQuery,
          total: filtered.length,
          items: filtered
        });
      });
    }
  );

  registerTool(
    'mcplab_read_tool_analysis_result',
    {
      description:
        'Read a saved MCP tool analysis report record (report.json) by report id and return parsed metadata plus optional raw JSON preview.',
      inputSchema: {
        report_id: z.string().describe("Report id directory name (or 'LATEST')."),
        tool_analysis_results_dir: z
          .string()
          .optional()
          .describe('Directory containing saved tool analysis reports.'),
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
    async ({ report_id, tool_analysis_results_dir, max_chars, include_record }) => {
      return withToolHandling(async () => {
        const baseDir = resolveToolAnalysisResultsDir(tool_analysis_results_dir);
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
      inputSchema: {
        report_id: z.string().describe('Report id directory name to delete.'),
        tool_analysis_results_dir: z
          .string()
          .optional()
          .describe('Directory containing saved tool analysis reports.')
      }
    },
    async ({ report_id, tool_analysis_results_dir }) => {
      return withToolHandling(async () => {
        const baseDir = resolveToolAnalysisResultsDir(tool_analysis_results_dir);
        const dirPath = toolAnalysisReportDirPathWithFallback(baseDir, report_id.trim());
        if (!existsSync(dirPath)) {
          throw new Error(`Tool analysis report not found: ${dirPath}`);
        }
        rmSync(dirPath, { recursive: true, force: false });
        return ok(`Deleted tool analysis report ${report_id}`, {
          report_id: report_id.trim(),
          path: dirPath,
          tool_analysis_results_dir: baseDir
        });
      });
    }
  );

  registerTool(
    'mcplab_trace_list_events',
    {
      description:
        'List structured trace timeline items for a MCPLab run (flattened from scenario_run trace records) with optional type/scenario/agent filtering.',
      inputSchema: {
        runs_dir: z
          .string()
          .optional()
          .describe('Runs directory (default mcplab/results/evaluation-runs).'),
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
    async ({ runs_dir, run_id, event_types, scenario_id, agent, limit }) => {
      return withToolHandling(async () => {
        const { runId, records, legacyDetected } = readScenarioRunTraceRecordsForRun(
          runs_dir,
          run_id
        );
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
      inputSchema: {
        runs_dir: z
          .string()
          .optional()
          .describe('Runs directory (default mcplab/results/evaluation-runs).'),
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
    async ({ runs_dir, run_id, scenario_id, agent, max_chars_per_answer }) => {
      return withToolHandling(async () => {
        const { runId, records, legacyDetected } = readScenarioRunTraceRecordsForRun(
          runs_dir,
          run_id
        );
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
      inputSchema: {
        runs_dir: z
          .string()
          .optional()
          .describe('Runs directory (default mcplab/results/evaluation-runs).'),
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
    async ({ runs_dir, run_id, scenario_id, agent, max_items, max_text_chars }) => {
      return withToolHandling(async () => {
        const { runId, records, legacyDetected } = readScenarioRunTraceRecordsForRun(
          runs_dir,
          run_id
        );
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
      inputSchema: {
        runs_dir: z
          .string()
          .optional()
          .describe('Runs directory (default mcplab/results/evaluation-runs).'),
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
    async ({ runs_dir, run_id, query, event_types, limit }) => {
      return withToolHandling(async () => {
        const q = query.trim().toLowerCase();
        if (!q) throw new Error('query is required');
        const { runId, records, legacyDetected } = readScenarioRunTraceRecordsForRun(
          runs_dir,
          run_id
        );
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
      inputSchema: {
        runs_dir: z
          .string()
          .optional()
          .describe('Runs directory (default mcplab/results/evaluation-runs).'),
        run_id: z.string().describe("Run id directory name or 'LATEST'.")
      }
    },
    async ({ runs_dir, run_id }) => {
      return withToolHandling(async () => {
        const { runId, records, legacyDetected } = readScenarioRunTraceRecordsForRun(
          runs_dir,
          run_id
        );
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
      inputSchema: {
        runs_dir: z
          .string()
          .optional()
          .describe('Runs directory (default mcplab/results/evaluation-runs).'),
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
    async ({ runs_dir, run_id, artifact, max_chars, line_start, line_end }) => {
      return withToolHandling(async () => {
        const base = resolveRunsDir(runs_dir);
        const readBase = resolveExistingRunReadDir(base, run_id === 'LATEST' ? undefined : run_id);
        const resolvedRunId = run_id === 'LATEST' ? latestRunId(readBase) : run_id;
        if (!resolvedRunId) {
          throw new Error(`No runs found in ${base}`);
        }
        const fullPath = join(readBase, resolvedRunId, artifact);
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
            const parsed = JSON.parse(raw) as ResultsJson;
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
    'mcplab_grep_run_artifact',
    {
      description:
        'Search for text within a MCPLab run artifact and return matching lines with surrounding context. Use this to find specific sections in large files (e.g. a tool name in report.html) without reading the full file. Returns line numbers so you can follow up with mcplab_read_run_artifact line_start/line_end to read the full section.',
      inputSchema: {
        runs_dir: z
          .string()
          .optional()
          .describe('Runs directory (default mcplab/results/evaluation-runs).'),
        run_id: z.string().describe("Run id directory name or 'LATEST'."),
        artifact: z
          .enum([
            'results.json',
            'summary.md',
            'trace.jsonl',
            'resolved-config.yaml',
            'report.html'
          ])
          .describe('Artifact filename to search.'),
        query: z.string().describe('Text to search for (case-insensitive by default).'),
        context_lines: z
          .number()
          .int()
          .min(0)
          .max(50)
          .optional()
          .describe('Lines of context before and after each match (default 5).'),
        max_matches: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe('Maximum number of matches to return (default 10).'),
        case_sensitive: z.boolean().optional().describe('Case-sensitive search (default false).')
      }
    },
    async ({ runs_dir, run_id, artifact, query, context_lines, max_matches, case_sensitive }) => {
      return withToolHandling(async () => {
        const base = resolveRunsDir(runs_dir);
        const readBase = resolveExistingRunReadDir(base, run_id === 'LATEST' ? undefined : run_id);
        const resolvedRunId = run_id === 'LATEST' ? latestRunId(readBase) : run_id;
        if (!resolvedRunId) throw new Error(`No runs found in ${base}`);

        const fullPath = join(readBase, resolvedRunId, artifact);
        if (!existsSync(fullPath)) throw new Error(`Artifact not found: ${fullPath}`);

        const lines = readFileSync(fullPath, 'utf8').split('\n');
        const q = case_sensitive ? query.trim() : query.trim().toLowerCase();
        if (!q) throw new Error('query must not be empty');
        const ctx = context_lines ?? 5;
        const limit = max_matches ?? 10;

        const matchIndices: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          const hay = case_sensitive ? lines[i] : lines[i].toLowerCase();
          if (hay.includes(q)) {
            matchIndices.push(i);
            if (matchIndices.length >= limit) break;
          }
        }

        const matches = matchIndices.map((matchIdx) => {
          const start = Math.max(0, matchIdx - ctx);
          const end = Math.min(lines.length - 1, matchIdx + ctx);
          return {
            match_line: matchIdx + 1,
            context_start_line: start + 1,
            context_end_line: end + 1,
            lines: lines.slice(start, end + 1).map((text, offset) => ({
              line: start + offset + 1,
              text,
              is_match: start + offset === matchIdx
            }))
          };
        });

        return ok(
          `Found ${matchIndices.length} match(es) for "${query}" in ${artifact} (run ${resolvedRunId})`,
          {
            run_id: resolvedRunId,
            artifact,
            query,
            total_lines: lines.length,
            match_count: matches.length,
            truncated_at_limit: matchIndices.length >= limit,
            matches
          }
        );
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
        bundle_root: z
          .string()
          .optional()
          .describe('Optional MCPLab library bundle root to inspect.'),
        server_ids: z
          .string()
          .optional()
          .describe('Comma-separated server ids to target if already known.'),
        agent_id: z.string().optional().describe('Optional pinned agent id.')
      }
    },
    async ({ task, bundle_root, server_ids, agent_id }) => {
      const maybeServers = server_ids
        ? `Target servers (if valid): ${server_ids}\n`
        : 'First inspect available servers with mcplab_list_library.\n';
      const maybeAgent = agent_id ? `Pinned agent (optional): ${agent_id}\n` : '';
      const maybeBundle = bundle_root ? `Bundle root hint: ${bundle_root}\n` : '';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Help me author a MCPLab scenario for this testing task:\n\n${task}\n\n` +
                `${maybeBundle}${maybeServers}${maybeAgent}` +
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
  mcplab_list_markdown_reports: 'Search Markdown Reports',
  mcplab_search_markdown_reports: 'Search Markdown Reports',
  mcplab_list_library: 'Search Library Entries',
  mcplab_generate_agent_entry: 'Generate MCPLab agents.yaml Entry',
  mcplab_list_runs: 'Search Evaluation Runs',
  mcplab_search_runs: 'Search Evaluation Runs',
  mcplab_list_tool_analysis_results: 'Search Tool Analysis Results',
  mcplab_search_tool_analysis_results: 'Search Tool Analysis Results',
  mcplab_trace_search: 'Search Trace Events',
  mcplab_grep_run_artifact: 'Search Run Artifact Text'
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
  const baseHints: ToolAnnotationHints =
    readOnly
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

function resolveBundleRoot(bundleRoot?: string): string {
  if (bundleRoot?.trim()) return resolve(bundleRoot);
  const cwd = process.cwd();
  const candidates = ['mcplab', 'examples/libraries'];
  for (const candidate of candidates) {
    const abs = resolve(cwd, candidate);
    if (existsSync(abs)) return abs;
  }
  return resolve(cwd, 'mcplab');
}

function readLibrary(bundleRoot: string, includeContent: boolean): Record<string, unknown> {
  const serversPath = join(bundleRoot, 'servers.yaml');
  const agentsPath = join(bundleRoot, 'agents.yaml');
  const scenariosDir = join(bundleRoot, 'scenarios');

  const servers = existsSync(serversPath)
    ? (parseYaml(readFileSync(serversPath, 'utf8')) as Record<string, unknown>) ?? {}
    : {};
  const agents = existsSync(agentsPath)
    ? (parseYaml(readFileSync(agentsPath, 'utf8')) as Record<string, unknown>) ?? {}
    : {};

  const scenarioEntries: Array<Record<string, unknown>> = [];
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

  const out: Record<string, unknown> = {
    bundleRoot,
    servers: includeContent
      ? servers
      : Object.keys(servers)
          .sort()
          .map((id) => ({ id })),
    agents: includeContent
      ? agents
      : Object.keys(agents)
          .sort()
          .map((id) => ({ id })),
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

function loadRunsForAnalysis(params: {
  runsDirInput?: string;
  runIds?: string[];
  latestN: number;
}): LoadedRunResult[] {
  const base = resolveRunsDir(params.runsDirInput);
  const ids = selectRunIdsForAnalysis(base, params.runIds, params.latestN);
  return ids.map((id) => loadSingleRunForAnalysis(base, id));
}

function loadSingleRunForAnalysis(primaryRunsDir: string, runIdInput: string): LoadedRunResult {
  const resolvedRunId = resolveRunIdToken(primaryRunsDir, runIdInput);
  const readBase = resolveExistingRunReadDir(primaryRunsDir, resolvedRunId);
  const runPath = join(readBase, resolvedRunId);
  const resultsPath = join(runPath, 'results.json');
  if (!existsSync(resultsPath)) {
    throw new Error(`results.json not found for run '${resolvedRunId}' at ${resultsPath}`);
  }
  const parsed = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
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

function buildAggregateRunsReport(params: {
  runs: LoadedRunResult[];
  scenarioIds?: string[];
  agents?: string[];
  groupBy: AggregateGroupBy;
  topN: number;
  includeDetails: boolean;
}): Record<string, unknown> {
  const scenarioFilter = normalizeOptionalFilterSet(params.scenarioIds);
  const agentFilter = normalizeOptionalFilterSet(params.agents);
  const selectedRuns = params.runs.map((run) => ({
    run_id: run.run_id,
    timestamp: run.results.metadata.timestamp,
    config_hash: run.results.metadata.config_hash
  }));
  const overallMetrics = computeMetricSummary(
    params.runs.flatMap((run) =>
      filterScenarios(run.results.scenarios, scenarioFilter, agentFilter)
    )
  );
  const rows = buildAggregateRows(params.runs, params.groupBy, scenarioFilter, agentFilter);
  const worstRows = [...rows]
    .sort(compareRowsWorstFirst)
    .slice(0, params.topN)
    .map(toSerializableAggregateRow);
  const bestRows = [...rows]
    .sort(compareRowsBestFirst)
    .slice(0, params.topN)
    .map(toSerializableAggregateRow);

  const structured = removeUndefined({
    runs: selectedRuns,
    group_by: params.groupBy,
    filters: removeUndefined({
      scenario_ids: params.scenarioIds?.length ? params.scenarioIds : undefined,
      agents: params.agents?.length ? params.agents : undefined
    }),
    summary: removeUndefined({
      ...overallMetrics,
      selected_run_count: params.runs.length
    }),
    top_worst: worstRows,
    top_best: bestRows,
    details: params.includeDetails
      ? rows.sort(compareRowsWorstFirst).map(toSerializableAggregateRow)
      : undefined
  });
  return structured;
}

function buildCompareRunsReport(params: {
  left: LoadedRunResult;
  right: LoadedRunResult;
  scenarioIds?: string[];
  agents?: string[];
  topN: number;
  includeDetails: boolean;
}): Record<string, unknown> {
  const scenarioFilter = normalizeOptionalFilterSet(params.scenarioIds);
  const agentFilter = normalizeOptionalFilterSet(params.agents);
  const leftScenarios = filterScenarios(params.left.results.scenarios, scenarioFilter, agentFilter);
  const rightScenarios = filterScenarios(
    params.right.results.scenarios,
    scenarioFilter,
    agentFilter
  );
  const leftSummary = computeMetricSummary(leftScenarios);
  const rightSummary = computeMetricSummary(rightScenarios);

  const leftMap = buildScenarioAgentMetricMap(leftScenarios);
  const rightMap = buildScenarioAgentMetricMap(rightScenarios);
  const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const rows: CompareRow[] = [];
  for (const key of keys) {
    const leftEntry = leftMap.get(key) ?? null;
    const rightEntry = rightMap.get(key) ?? null;
    const classification = classifyCompareRow(
      leftEntry?.summary ?? null,
      rightEntry?.summary ?? null
    );
    rows.push({
      key,
      scenario_id: leftEntry?.scenario_id ?? rightEntry?.scenario_id ?? '',
      agent: leftEntry?.agent ?? rightEntry?.agent ?? '',
      classification,
      left: leftEntry?.summary ?? null,
      right: rightEntry?.summary ?? null,
      deltas: {
        pass_rate:
          leftEntry && rightEntry
            ? roundedDelta(rightEntry.summary.pass_rate - leftEntry.summary.pass_rate)
            : null,
        failed_runs:
          leftEntry && rightEntry
            ? rightEntry.summary.failed_runs - leftEntry.summary.failed_runs
            : null,
        avg_tool_calls_per_run:
          leftEntry && rightEntry
            ? roundedDelta(
                rightEntry.summary.avg_tool_calls_per_run - leftEntry.summary.avg_tool_calls_per_run
              )
            : null,
        avg_tool_latency_ms:
          leftEntry && rightEntry
            ? nullableRoundedDelta(
                rightEntry.summary.avg_tool_latency_ms,
                leftEntry.summary.avg_tool_latency_ms
              )
            : null
      }
    });
  }

  const regressions = rows
    .filter((row) => row.classification === 'regressed')
    .sort(compareRegressionRows)
    .slice(0, params.topN);
  const improvements = rows
    .filter((row) => row.classification === 'improved')
    .sort(compareImprovementRows)
    .slice(0, params.topN);
  const newItems = rows
    .filter((row) => row.classification === 'new')
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, params.topN);
  const missingItems = rows
    .filter((row) => row.classification === 'missing')
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, params.topN);

  const classificationCounts = rows.reduce<Record<CompareClass, number>>(
    (acc, row) => {
      acc[row.classification] += 1;
      return acc;
    },
    { regressed: 0, improved: 0, unchanged: 0, new: 0, missing: 0 }
  );

  return removeUndefined({
    left_run: {
      run_id: params.left.run_id,
      timestamp: params.left.results.metadata.timestamp,
      config_hash: params.left.results.metadata.config_hash
    },
    right_run: {
      run_id: params.right.run_id,
      timestamp: params.right.results.metadata.timestamp,
      config_hash: params.right.results.metadata.config_hash
    },
    filters: removeUndefined({
      scenario_ids: params.scenarioIds?.length ? params.scenarioIds : undefined,
      agents: params.agents?.length ? params.agents : undefined
    }),
    summary: {
      left: leftSummary,
      right: rightSummary,
      deltas: {
        pass_rate: roundedDelta(rightSummary.pass_rate - leftSummary.pass_rate),
        failed_runs: rightSummary.failed_runs - leftSummary.failed_runs,
        avg_tool_calls_per_run: roundedDelta(
          rightSummary.avg_tool_calls_per_run - leftSummary.avg_tool_calls_per_run
        ),
        avg_tool_latency_ms: nullableRoundedDelta(
          rightSummary.avg_tool_latency_ms,
          leftSummary.avg_tool_latency_ms
        )
      },
      classification_counts: classificationCounts
    },
    regressions: regressions.map(toSerializableCompareRow),
    improvements: improvements.map(toSerializableCompareRow),
    new_items: newItems.map(toSerializableCompareRow),
    missing_items: missingItems.map(toSerializableCompareRow),
    details: params.includeDetails
      ? rows
          .sort(
            (a, b) =>
              compareClassPriority(a.classification) - compareClassPriority(b.classification) ||
              a.key.localeCompare(b.key)
          )
          .map(toSerializableCompareRow)
      : undefined
  });
}

const QUALITY_DIMENSIONS: QualityDimension[] = [
  'factuality',
  'completeness',
  'actionability',
  'clarity'
];
const QUALITY_RUBRIC_ID = 'quality_v1_4d';
const QUALITY_CLASSIFY_EPSILON = 0.15;
const MAX_QUALITY_COMPARE_PAIRS = 100;

function loadDefaultQualityJudgeAgent(): { agentName: string; agentConfig: AgentConfig } {
  const bundleRoot = resolveBundleRoot();
  const agentsPath = join(bundleRoot, 'agents.yaml');
  if (!existsSync(agentsPath)) {
    throw new Error(`No agents.yaml found at ${agentsPath}; cannot resolve default judge agent.`);
  }
  const raw = readFileSync(agentsPath, 'utf8');
  const agents = ((parseYaml(raw) as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const agentNames = Object.keys(agents);
  const agentName = agentNames[0];
  if (!agentName) {
    throw new Error(`No agents found in ${agentsPath}; cannot resolve default judge agent.`);
  }
  const value = agents[agentName];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Agent '${agentName}' in ${agentsPath} is invalid.`);
  }
  const cfg = value as Record<string, unknown>;
  const provider = cfg.provider;
  const model = cfg.model;
  if (
    typeof provider !== 'string' ||
    (provider !== 'openai' && provider !== 'anthropic' && provider !== 'azure_openai')
  ) {
    throw new Error(`Agent '${agentName}' provider is invalid in ${agentsPath}.`);
  }
  if (typeof model !== 'string' || !model.trim()) {
    throw new Error(`Agent '${agentName}' model is invalid in ${agentsPath}.`);
  }
  const normalized: AgentConfig = {
    ...(cfg as unknown as AgentConfig),
    provider,
    model
  };
  return {
    agentName,
    agentConfig: { ...normalized, temperature: 0 }
  };
}

async function buildCompareAnswerQualityReport(params: {
  left: LoadedRunResult;
  right: LoadedRunResult;
  scenarioIds?: string[];
  agents?: string[];
  topN: number;
  includeRationales: boolean;
  includeDetails: boolean;
  judge: { agentName: string; agentConfig: AgentConfig };
}): Promise<Record<string, unknown>> {
  const scenarioFilter = normalizeOptionalFilterSet(params.scenarioIds);
  const agentFilter = normalizeOptionalFilterSet(params.agents);
  const leftMap = buildScenarioAgentAnswerMap(
    params.left.results.scenarios,
    scenarioFilter,
    agentFilter
  );
  const rightMap = buildScenarioAgentAnswerMap(
    params.right.results.scenarios,
    scenarioFilter,
    agentFilter
  );
  const keys = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()])).sort();
  const cappedKeys = keys.slice(0, MAX_QUALITY_COMPARE_PAIRS);
  const rows: QualityCompareRow[] = [];

  for (const key of cappedKeys) {
    const left = leftMap.get(key) ?? null;
    const right = rightMap.get(key) ?? null;
    if (!left && right) {
      rows.push({
        key,
        scenario_id: right.scenario_id,
        agent: right.agent,
        classification: 'new',
        left: null,
        right: null,
        deltas: {
          overall_score: null,
          dimension_scores: {
            factuality: null,
            completeness: null,
            actionability: null,
            clarity: null
          }
        },
        confidence: null
      });
      continue;
    }
    if (left && !right) {
      rows.push({
        key,
        scenario_id: left.scenario_id,
        agent: left.agent,
        classification: 'missing',
        left: null,
        right: null,
        deltas: {
          overall_score: null,
          dimension_scores: {
            factuality: null,
            completeness: null,
            actionability: null,
            clarity: null
          }
        },
        confidence: null
      });
      continue;
    }
    if (!left || !right) continue;

    const judged = await judgeAnswerPairDualOrder({
      scenarioId: left.scenario_id,
      agent: left.agent,
      leftAnswer: left.answer_text,
      rightAnswer: right.answer_text,
      judgeAgent: params.judge.agentConfig
    });

    if ('judge_error' in judged) {
      rows.push({
        key,
        scenario_id: left.scenario_id,
        agent: left.agent,
        classification: 'unchanged',
        left: null,
        right: null,
        deltas: {
          overall_score: null,
          dimension_scores: {
            factuality: null,
            completeness: null,
            actionability: null,
            clarity: null
          }
        },
        confidence: null,
        judge_error: judged.judge_error
      });
      continue;
    }

    const classification = classifyQualityCompareByDelta(judged.deltas.overall_score);
    rows.push({
      key,
      scenario_id: left.scenario_id,
      agent: left.agent,
      classification,
      left: judged.left,
      right: judged.right,
      deltas: judged.deltas,
      confidence: judged.confidence,
      rationale: params.includeRationales ? judged.rationale : undefined
    });
  }

  return buildQualityReportFromRows({
    left: params.left,
    right: params.right,
    rows,
    topN: params.topN,
    includeRationales: params.includeRationales,
    includeDetails: params.includeDetails,
    judgeAgentName: params.judge.agentName,
    truncatedByPairCap: keys.length > cappedKeys.length
  });
}

function buildScenarioAgentAnswerMap(
  scenarios: ResultsJson['scenarios'],
  scenarioFilter: Set<string> | null,
  agentFilter: Set<string> | null
): Map<string, { scenario_id: string; agent: string; answer_text: string }> {
  const filtered = filterScenarios(scenarios, scenarioFilter, agentFilter);
  const out = new Map<string, { scenario_id: string; agent: string; answer_text: string }>();
  for (const scenario of filtered) {
    const answerText =
      scenario.last_final_answer ||
      scenario.runs
        .map((run) => run.final_text)
        .filter((text) => String(text).trim().length > 0)
        .at(-1) ||
      '';
    const key = `${scenario.scenario_id}::${scenario.agent}`;
    out.set(key, {
      scenario_id: scenario.scenario_id,
      agent: scenario.agent,
      answer_text: answerText
    });
  }
  return out;
}

async function judgeAnswerPairDualOrder(params: {
  scenarioId: string;
  agent: string;
  leftAnswer: string;
  rightAnswer: string;
  judgeAgent: AgentConfig;
}): Promise<
  | {
      left: { dimension_scores: QualityScoreSet; overall_score: number };
      right: { dimension_scores: QualityScoreSet; overall_score: number };
      deltas: {
        overall_score: number;
        dimension_scores: Record<QualityDimension, number>;
      };
      confidence: number;
      rationale: string;
    }
  | { judge_error: string }
> {
  try {
    const forward = await judgeAnswerPairOrdered({
      scenarioId: params.scenarioId,
      agent: params.agent,
      answerA: params.leftAnswer,
      answerB: params.rightAnswer,
      judgeAgent: params.judgeAgent
    });
    const reverse = await judgeAnswerPairOrdered({
      scenarioId: params.scenarioId,
      agent: params.agent,
      answerA: params.rightAnswer,
      answerB: params.leftAnswer,
      judgeAgent: params.judgeAgent
    });
    const normalizedReverse = {
      answer_a: reverse.answer_b,
      answer_b: reverse.answer_a,
      confidence: reverse.confidence,
      rationale: reverse.rationale
    };
    const merged = mergeQualityJudgeResponses(forward, normalizedReverse);
    return merged;
  } catch (error) {
    return { judge_error: error instanceof Error ? error.message : String(error) };
  }
}

async function judgeAnswerPairOrdered(params: {
  scenarioId: string;
  agent: string;
  answerA: string;
  answerB: string;
  judgeAgent: AgentConfig;
}): Promise<QualityJudgeResponse> {
  const system = qualityJudgeSystemPrompt();
  const user = qualityJudgeUserPrompt({
    scenarioId: params.scenarioId,
    agent: params.agent,
    answerA: params.answerA,
    answerB: params.answerB
  });
  const first = await chatWithAgent({
    agent: params.judgeAgent,
    system,
    messages: [{ role: 'user', content: user }]
  });
  try {
    return parseAndValidateQualityJudgeResponse(first.content ?? '');
  } catch {
    const retry = await chatWithAgent({
      agent: params.judgeAgent,
      system,
      messages: [
        { role: 'user', content: user },
        { role: 'assistant', content: first.content ?? '' },
        {
          role: 'user',
          content:
            'Return valid JSON only. No prose. No markdown. Use exactly the requested schema.'
        }
      ]
    });
    return parseAndValidateQualityJudgeResponse(retry.content ?? '');
  }
}

function qualityJudgeSystemPrompt(): string {
  return [
    'You are an answer-quality judge for MCP evaluation outputs.',
    `Rubric id: ${QUALITY_RUBRIC_ID}. Score each answer independently.`,
    'Dimensions (integer 1-5): factuality, completeness, actionability, clarity.',
    'Overall score is also integer 1-5.',
    'Confidence is 0..1.',
    'Be concise and objective. Avoid style bias.',
    'Return JSON only with keys:',
    'answer_a: { dimension_scores: { factuality, completeness, actionability, clarity }, overall_score }',
    'answer_b: { dimension_scores: { factuality, completeness, actionability, clarity }, overall_score }',
    'confidence',
    'rationale'
  ].join('\n');
}

function qualityJudgeUserPrompt(params: {
  scenarioId: string;
  agent: string;
  answerA: string;
  answerB: string;
}): string {
  return [
    `Scenario: ${params.scenarioId}`,
    `Agent: ${params.agent}`,
    '',
    'Answer A:',
    params.answerA || '(empty)',
    '',
    'Answer B:',
    params.answerB || '(empty)'
  ].join('\n');
}

function parseAndValidateQualityJudgeResponse(text: string): QualityJudgeResponse {
  const parsed = parseJsonFromAssistantText(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Judge response must be a JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  const answerA = validateQualityAnswerScore(obj.answer_a, 'answer_a');
  const answerB = validateQualityAnswerScore(obj.answer_b, 'answer_b');
  const confidence = validateNumberInRange(obj.confidence, 0, 1, 'confidence');
  const rationaleRaw = typeof obj.rationale === 'string' ? obj.rationale.trim() : '';
  const rationale = truncate(rationaleRaw || 'No rationale provided.', 400);
  return {
    answer_a: answerA,
    answer_b: answerB,
    confidence: roundedDelta(confidence),
    rationale
  };
}

function validateQualityAnswerScore(
  value: unknown,
  path: string
): {
  dimension_scores: QualityScoreSet;
  overall_score: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  const obj = value as Record<string, unknown>;
  const dims = obj.dimension_scores;
  if (!dims || typeof dims !== 'object' || Array.isArray(dims)) {
    throw new Error(`${path}.dimension_scores must be an object`);
  }
  const dimObj = dims as Record<string, unknown>;
  const scores = {} as QualityScoreSet;
  for (const dim of QUALITY_DIMENSIONS) {
    scores[dim] = validateIntegerInRange(dimObj[dim], 1, 5, `${path}.dimension_scores.${dim}`);
  }
  const overall = validateIntegerInRange(obj.overall_score, 1, 5, `${path}.overall_score`);
  return { dimension_scores: scores, overall_score: overall };
}

function validateIntegerInRange(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${path} must be an integer`);
  }
  if (value < min || value > max) {
    throw new Error(`${path} must be between ${min} and ${max}`);
  }
  return value;
}

function validateNumberInRange(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a number`);
  }
  if (value < min || value > max) {
    throw new Error(`${path} must be between ${min} and ${max}`);
  }
  return value;
}

function mergeQualityJudgeResponses(
  first: QualityJudgeResponse,
  second: QualityJudgeResponse
): {
  left: { dimension_scores: QualityScoreSet; overall_score: number };
  right: { dimension_scores: QualityScoreSet; overall_score: number };
  deltas: {
    overall_score: number;
    dimension_scores: Record<QualityDimension, number>;
  };
  confidence: number;
  rationale: string;
} {
  const leftDims = {} as QualityScoreSet;
  const rightDims = {} as QualityScoreSet;
  const deltas = {} as Record<QualityDimension, number>;
  for (const dim of QUALITY_DIMENSIONS) {
    const leftAvg =
      (first.answer_a.dimension_scores[dim] + second.answer_a.dimension_scores[dim]) / 2;
    const rightAvg =
      (first.answer_b.dimension_scores[dim] + second.answer_b.dimension_scores[dim]) / 2;
    leftDims[dim] = roundedDelta(leftAvg);
    rightDims[dim] = roundedDelta(rightAvg);
    deltas[dim] = roundedDelta(rightAvg - leftAvg);
  }
  const leftOverall = roundedDelta(
    (first.answer_a.overall_score + second.answer_a.overall_score) / 2
  );
  const rightOverall = roundedDelta(
    (first.answer_b.overall_score + second.answer_b.overall_score) / 2
  );
  return {
    left: { dimension_scores: leftDims, overall_score: leftOverall },
    right: { dimension_scores: rightDims, overall_score: rightOverall },
    deltas: {
      overall_score: roundedDelta(rightOverall - leftOverall),
      dimension_scores: deltas
    },
    confidence: roundedDelta((first.confidence + second.confidence) / 2),
    rationale: truncate(`${first.rationale}\n---\n${second.rationale}`, 500)
  };
}

function classifyQualityCompareByDelta(delta: number): QualityCompareClass {
  if (delta > QUALITY_CLASSIFY_EPSILON) return 'improved';
  if (delta < -QUALITY_CLASSIFY_EPSILON) return 'regressed';
  return 'unchanged';
}

function buildQualityReportFromRows(params: {
  left: LoadedRunResult;
  right: LoadedRunResult;
  rows: QualityCompareRow[];
  topN: number;
  includeRationales: boolean;
  includeDetails: boolean;
  judgeAgentName: string;
  truncatedByPairCap: boolean;
}): Record<string, unknown> {
  const comparable = params.rows.filter((row) => row.left && row.right && !row.judge_error);
  const leftOverallAvg =
    comparable.length === 0
      ? null
      : roundedDelta(
          comparable.reduce((sum, row) => sum + (row.left?.overall_score ?? 0), 0) /
            comparable.length
        );
  const rightOverallAvg =
    comparable.length === 0
      ? null
      : roundedDelta(
          comparable.reduce((sum, row) => sum + (row.right?.overall_score ?? 0), 0) /
            comparable.length
        );
  const dimensionAverages = QUALITY_DIMENSIONS.reduce<Record<QualityDimension, number | null>>(
    (acc, dim) => {
      acc[dim] =
        comparable.length === 0
          ? null
          : roundedDelta(
              comparable.reduce((sum, row) => sum + (row.deltas.dimension_scores[dim] ?? 0), 0) /
                comparable.length
            );
      return acc;
    },
    { factuality: null, completeness: null, actionability: null, clarity: null }
  );
  const counts = params.rows.reduce<Record<QualityCompareClass, number>>(
    (acc, row) => {
      acc[row.classification] += 1;
      return acc;
    },
    { regressed: 0, improved: 0, unchanged: 0, new: 0, missing: 0 }
  );
  const regressions = params.rows
    .filter((row) => row.classification === 'regressed')
    .sort(
      (a, b) =>
        (a.deltas.overall_score ?? 0) - (b.deltas.overall_score ?? 0) || a.key.localeCompare(b.key)
    )
    .slice(0, params.topN);
  const improvements = params.rows
    .filter((row) => row.classification === 'improved')
    .sort(
      (a, b) =>
        (b.deltas.overall_score ?? 0) - (a.deltas.overall_score ?? 0) || a.key.localeCompare(b.key)
    )
    .slice(0, params.topN);
  const newItems = params.rows
    .filter((row) => row.classification === 'new')
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, params.topN);
  const missingItems = params.rows
    .filter((row) => row.classification === 'missing')
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, params.topN);

  return removeUndefined({
    left_run: {
      run_id: params.left.run_id,
      timestamp: params.left.results.metadata.timestamp,
      config_hash: params.left.results.metadata.config_hash
    },
    right_run: {
      run_id: params.right.run_id,
      timestamp: params.right.results.metadata.timestamp,
      config_hash: params.right.results.metadata.config_hash
    },
    rubric: {
      rubric_id: QUALITY_RUBRIC_ID,
      scale: { min: 1, max: 5 },
      dimensions: QUALITY_DIMENSIONS
    },
    judge: {
      source: 'assistant_default_agent',
      agent_name: params.judgeAgentName
    },
    summary: {
      comparable_pairs: comparable.length,
      classification_counts: counts,
      left_avg_overall: leftOverallAvg,
      right_avg_overall: rightOverallAvg,
      delta_overall_avg:
        leftOverallAvg === null || rightOverallAvg === null
          ? null
          : roundedDelta(rightOverallAvg - leftOverallAvg),
      delta_dimension_avgs: dimensionAverages,
      judge_error_count: params.rows.filter((row) => Boolean(row.judge_error)).length
    },
    truncated_by_pair_cap: params.truncatedByPairCap || undefined,
    top_regressions: regressions.map((row) =>
      toSerializableQualityCompareRow(row, params.includeRationales)
    ),
    top_improvements: improvements.map((row) =>
      toSerializableQualityCompareRow(row, params.includeRationales)
    ),
    new_items: newItems.map((row) =>
      toSerializableQualityCompareRow(row, params.includeRationales)
    ),
    missing_items: missingItems.map((row) =>
      toSerializableQualityCompareRow(row, params.includeRationales)
    ),
    details: params.includeDetails
      ? params.rows
          .slice()
          .sort(
            (a, b) =>
              compareQualityClassPriority(a.classification) -
                compareQualityClassPriority(b.classification) || a.key.localeCompare(b.key)
          )
          .map((row) => toSerializableQualityCompareRow(row, params.includeRationales))
      : undefined
  });
}

function compareQualityClassPriority(classification: QualityCompareClass): number {
  if (classification === 'regressed') return 0;
  if (classification === 'improved') return 1;
  if (classification === 'new') return 2;
  if (classification === 'missing') return 3;
  return 4;
}

function toSerializableQualityCompareRow(
  row: QualityCompareRow,
  includeRationales: boolean
): Record<string, unknown> {
  return removeUndefined({
    key: row.key,
    scenario_id: row.scenario_id,
    agent: row.agent,
    classification: row.classification,
    left: row.left,
    right: row.right,
    deltas: row.deltas,
    confidence: row.confidence,
    rationale: includeRationales ? row.rationale : undefined,
    judge_error: row.judge_error
  });
}

function extractFirstBalancedJsonCandidate(text: string): string | null {
  const starts: Array<{ idx: number; open: '{' | '['; close: '}' | ']' }> = [];
  const firstObj = text.indexOf('{');
  if (firstObj >= 0) starts.push({ idx: firstObj, open: '{', close: '}' });
  const firstArr = text.indexOf('[');
  if (firstArr >= 0) starts.push({ idx: firstArr, open: '[', close: ']' });
  starts.sort((a, b) => a.idx - b.idx);

  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start.idx; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === start.open) depth += 1;
      if (ch === start.close) {
        depth -= 1;
        if (depth === 0) return text.slice(start.idx, i + 1);
      }
    }
  }
  return null;
}

function parseJsonFromAssistantText(text: string): unknown {
  const cleaned = text.trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const fenced =
      cleaned.match(/```json\s*([\s\S]+?)```/i) ?? cleaned.match(/```\s*([\s\S]+?)```/i);
    if (fenced) return JSON.parse(fenced[1].trim());
    const candidate = extractFirstBalancedJsonCandidate(cleaned);
    if (candidate) return JSON.parse(candidate);
    throw new Error('Assistant returned invalid JSON');
  }
}

function normalizeOptionalFilterSet(values?: string[]): Set<string> | null {
  if (!values || values.length === 0) return null;
  const set = new Set(values.map((v) => String(v).trim()).filter(Boolean));
  return set.size > 0 ? set : null;
}

function filterScenarios(
  scenarios: ResultsJson['scenarios'],
  scenarioFilter: Set<string> | null,
  agentFilter: Set<string> | null
): ResultsJson['scenarios'] {
  return scenarios.filter((scenario) => {
    const scenarioOk = !scenarioFilter || scenarioFilter.has(scenario.scenario_id);
    const agentOk = !agentFilter || agentFilter.has(scenario.agent);
    return scenarioOk && agentOk;
  });
}

function computeMetricSummary(scenarios: ResultsJson['scenarios']): MetricSummary {
  let totalRuns = 0;
  let passedRuns = 0;
  let toolCallTotal = 0;
  let toolDurationTotal = 0;
  let toolDurationCount = 0;

  for (const scenario of scenarios) {
    totalRuns += scenario.runs.length;
    for (const run of scenario.runs) {
      if (run.pass) passedRuns += 1;
      toolCallTotal += run.tool_call_count;
      for (const duration of run.tool_durations_ms) {
        toolDurationTotal += duration;
        toolDurationCount += 1;
      }
    }
  }

  return {
    total_runs: totalRuns,
    passed_runs: passedRuns,
    failed_runs: totalRuns - passedRuns,
    pass_rate: totalRuns === 0 ? 0 : roundedDelta(passedRuns / totalRuns),
    avg_tool_calls_per_run: totalRuns === 0 ? 0 : roundedDelta(toolCallTotal / totalRuns),
    avg_tool_latency_ms:
      toolDurationCount === 0 ? null : roundedDelta(toolDurationTotal / toolDurationCount)
  };
}

function buildAggregateRows(
  runs: LoadedRunResult[],
  groupBy: AggregateGroupBy,
  scenarioFilter: Set<string> | null,
  agentFilter: Set<string> | null
): AggregateGroupRow[] {
  if (groupBy === 'run') {
    return runs.map((run) => {
      const scenarios = filterScenarios(run.results.scenarios, scenarioFilter, agentFilter);
      const summary = computeMetricSummary(scenarios);
      return {
        key: run.run_id,
        run_id: run.run_id,
        run_count: 1,
        timestamp_range: {
          min: run.results.metadata.timestamp,
          max: run.results.metadata.timestamp
        },
        ...summary
      };
    });
  }

  const bucket = new Map<
    string,
    {
      key: string;
      scenario_id?: string;
      agent?: string;
      runIds: Set<string>;
      minTimestamp: string | null;
      maxTimestamp: string | null;
      scenarios: ResultsJson['scenarios'];
    }
  >();

  for (const run of runs) {
    const scenarios = filterScenarios(run.results.scenarios, scenarioFilter, agentFilter);
    for (const scenario of scenarios) {
      const key = groupBy === 'scenario' ? scenario.scenario_id : scenario.agent;
      const existing = bucket.get(key);
      if (existing) {
        existing.runIds.add(run.run_id);
        existing.scenarios.push(scenario);
        existing.minTimestamp =
          !existing.minTimestamp || run.results.metadata.timestamp < existing.minTimestamp
            ? run.results.metadata.timestamp
            : existing.minTimestamp;
        existing.maxTimestamp =
          !existing.maxTimestamp || run.results.metadata.timestamp > existing.maxTimestamp
            ? run.results.metadata.timestamp
            : existing.maxTimestamp;
        continue;
      }
      bucket.set(key, {
        key,
        scenario_id: groupBy === 'scenario' ? scenario.scenario_id : undefined,
        agent: groupBy === 'agent' ? scenario.agent : undefined,
        runIds: new Set([run.run_id]),
        minTimestamp: run.results.metadata.timestamp,
        maxTimestamp: run.results.metadata.timestamp,
        scenarios: [scenario]
      });
    }
  }

  const out: AggregateGroupRow[] = [];
  for (const entry of bucket.values()) {
    const summary = computeMetricSummary(entry.scenarios);
    out.push({
      key: entry.key,
      scenario_id: entry.scenario_id,
      agent: entry.agent,
      run_count: entry.runIds.size,
      timestamp_range:
        entry.minTimestamp && entry.maxTimestamp
          ? { min: entry.minTimestamp, max: entry.maxTimestamp }
          : undefined,
      ...summary
    });
  }
  return out;
}

function buildScenarioAgentMetricMap(
  scenarios: ResultsJson['scenarios']
): Map<string, { scenario_id: string; agent: string; summary: MetricSummary }> {
  const map = new Map<string, { scenario_id: string; agent: string; summary: MetricSummary }>();
  for (const scenario of scenarios) {
    const key = `${scenario.scenario_id}::${scenario.agent}`;
    map.set(key, {
      scenario_id: scenario.scenario_id,
      agent: scenario.agent,
      summary: computeMetricSummary([scenario])
    });
  }
  return map;
}

function classifyCompareRow(left: MetricSummary | null, right: MetricSummary | null): CompareClass {
  if (!left && right) return 'new';
  if (left && !right) return 'missing';
  if (!left || !right) return 'unchanged';
  const passDelta = right.pass_rate - left.pass_rate;
  if (passDelta < 0) return 'regressed';
  if (passDelta > 0) return 'improved';
  const failedDelta = right.failed_runs - left.failed_runs;
  if (failedDelta > 0) return 'regressed';
  if (failedDelta < 0) return 'improved';
  return 'unchanged';
}

function compareRowsWorstFirst(a: AggregateGroupRow, b: AggregateGroupRow): number {
  if (a.pass_rate !== b.pass_rate) return a.pass_rate - b.pass_rate;
  if (a.failed_runs !== b.failed_runs) return b.failed_runs - a.failed_runs;
  return a.key.localeCompare(b.key);
}

function compareRowsBestFirst(a: AggregateGroupRow, b: AggregateGroupRow): number {
  if (a.pass_rate !== b.pass_rate) return b.pass_rate - a.pass_rate;
  if (a.failed_runs !== b.failed_runs) return a.failed_runs - b.failed_runs;
  return a.key.localeCompare(b.key);
}

function compareRegressionRows(a: CompareRow, b: CompareRow): number {
  const aDelta = a.deltas.pass_rate ?? 0;
  const bDelta = b.deltas.pass_rate ?? 0;
  if (aDelta !== bDelta) return aDelta - bDelta;
  const aFailed = a.deltas.failed_runs ?? 0;
  const bFailed = b.deltas.failed_runs ?? 0;
  if (aFailed !== bFailed) return bFailed - aFailed;
  return a.key.localeCompare(b.key);
}

function compareImprovementRows(a: CompareRow, b: CompareRow): number {
  const aDelta = a.deltas.pass_rate ?? 0;
  const bDelta = b.deltas.pass_rate ?? 0;
  if (aDelta !== bDelta) return bDelta - aDelta;
  const aFailed = a.deltas.failed_runs ?? 0;
  const bFailed = b.deltas.failed_runs ?? 0;
  if (aFailed !== bFailed) return aFailed - bFailed;
  return a.key.localeCompare(b.key);
}

function compareClassPriority(classification: CompareClass): number {
  if (classification === 'regressed') return 0;
  if (classification === 'improved') return 1;
  if (classification === 'new') return 2;
  if (classification === 'missing') return 3;
  return 4;
}

function toSerializableAggregateRow(row: AggregateGroupRow): Record<string, unknown> {
  return removeUndefined({
    key: row.key,
    run_id: row.run_id,
    scenario_id: row.scenario_id,
    agent: row.agent,
    run_count: row.run_count,
    timestamp_range: row.timestamp_range,
    total_runs: row.total_runs,
    passed_runs: row.passed_runs,
    failed_runs: row.failed_runs,
    pass_rate: row.pass_rate,
    avg_tool_calls_per_run: row.avg_tool_calls_per_run,
    avg_tool_latency_ms: row.avg_tool_latency_ms
  });
}

function toSerializableCompareRow(row: CompareRow): Record<string, unknown> {
  return {
    key: row.key,
    scenario_id: row.scenario_id,
    agent: row.agent,
    classification: row.classification,
    left: row.left,
    right: row.right,
    deltas: row.deltas
  };
}

function roundedDelta(value: number): number {
  return Number(value.toFixed(6));
}

function nullableRoundedDelta(right: number | null, left: number | null): number | null {
  if (right === null || left === null) return null;
  return roundedDelta(right - left);
}

function listRuns(
  runsDir: string,
  limit: number,
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
    .reverse()
    .slice(0, limit);

  return dirNames.map((runId) => {
    const out: Record<string, unknown> = {
      run_id: runId,
      path: join(runsDir, runId)
    };
    if (includeSummary) {
      const resultsPath = join(runsDir, runId, 'results.json');
      if (existsSync(resultsPath)) {
        try {
          const parsed = JSON.parse(readFileSync(resultsPath, 'utf8')) as ResultsJson;
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
  return resolvePathInsideWorkspace('mcplab/results/evaluation-runs');
}

function legacyRunsDirPath(): string {
  return resolvePathInsideWorkspace('mcplab/runs');
}

function resolveRunsDir(input?: string): string {
  return resolve(input?.trim() ? input : defaultRunsDirPath());
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
  limit: number,
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
    .slice(0, limit);
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

function resolveToolAnalysisResultsDir(input?: string): string {
  return resolvePathInsideWorkspace(input?.trim() ? input : 'mcplab/results/tool-analysis');
}

function resolveMarkdownReportsDir(input?: string): string {
  return resolvePathInsideWorkspace(input?.trim() ? input : 'mcplab/reports');
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
  const workspaceRelativePrefix = `mcplab${sep}reports${sep}`;
  const normalized = trimmed.replaceAll('/', sep);
  const candidate =
    normalized === `mcplab${sep}reports` || normalized.startsWith(workspaceRelativePrefix)
      ? resolvePathInsideWorkspace(normalized)
      : resolve(root, normalized);
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
  limit: number
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
    .reverse()
    .slice(0, limit);
  const out: Array<Record<string, unknown>> = [];
  for (const reportId of ids) {
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
  limit: number
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
    .slice(0, limit);
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

function readScenarioRunTraceRecordsForRun(
  runsDirInput: string | undefined,
  runIdInput: string
): ReadScenarioRunTraceResult {
  const base = resolveRunsDir(runsDirInput);
  const readBase = resolveExistingRunReadDir(
    base,
    runIdInput === 'LATEST' ? undefined : runIdInput
  );
  const runId = runIdInput === 'LATEST' ? latestRunId(readBase) : runIdInput;
  if (!runId) throw new Error(`No runs found in ${base}`);
  const tracePath = join(readBase, runId, 'trace.jsonl');
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
    content: [{ type: 'text', text: `Error: ${message}` }],
    structuredContent: { error: message }
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

export const __testExports = {
  selectRunIdsForAnalysis,
  resolveRunIdToken,
  computeMetricSummary,
  buildAggregateRows,
  classifyCompareRow,
  buildAggregateRunsReport,
  buildCompareRunsReport,
  parseAndValidateQualityJudgeResponse,
  mergeQualityJudgeResponses,
  classifyQualityCompareByDelta,
  buildQualityReportFromRows
};

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
