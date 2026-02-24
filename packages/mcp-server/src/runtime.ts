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
import { dirname, extname, resolve, join, sep } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  loadConfig,
  runAll,
  selectScenarios,
  type EvalConfig,
  type ExecutableEvalConfig,
  type ResultsJson
} from '@inspectr/mcplab-core';
import { renderReport } from '@inspectr/mcplab-reporting';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

const SERVER_VERSION = '0.1.0';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const DEFAULT_MCP_PATH = '/mcp';
const DEFAULT_MCP_PORT = 3011;
const DEFAULT_MCP_HOST = '127.0.0.1';

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
    version: SERVER_VERSION
  });
  registerTools(server);
  registerPrompts(server);
  return server;
}

export function registerTools(server: McpServer): void {
  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'mcplab_generate_server_entry',
    {
      description:
        'Generate a MCPLab servers.yaml entry (or inline config block) for an MCP server connection.',
      inputSchema: {
        id: z.string().describe('Server id key (kebab-case recommended).'),
        url: z.string().describe('MCP server URL (Streamable HTTP endpoint).'),
        transport: z.enum(['http']).optional().describe('MCPLab transport type (currently http).'),
        auth_type: z
          .enum(['none', 'bearer', 'oauth_client_credentials'])
          .optional()
          .describe('Authentication mode.'),
        bearer_env: z
          .string()
          .optional()
          .describe('Env var for bearer token when auth_type=bearer.'),
        oauth_token_url: z
          .string()
          .optional()
          .describe('OAuth token URL when auth_type=oauth_client_credentials.'),
        oauth_client_id_env: z.string().optional().describe('OAuth client id env var.'),
        oauth_client_secret_env: z.string().optional().describe('OAuth client secret env var.'),
        oauth_scope: z.string().optional().describe('Optional OAuth scope.'),
        oauth_audience: z.string().optional().describe('Optional OAuth audience.')
      }
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'mcplab_run_eval',
    {
      description:
        'Run a MCPLab evaluation using mcplab-core runAll() from a config file and return the run directory plus summary metrics.',
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
          .describe('Output directory for run artifacts (default mcplab/runs).')
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
          runsDir: runs_dir ?? 'mcplab/runs'
        });

        const reportHtml = renderReport(results);
        return ok(`MCPLab run completed: ${runDir}`, {
          runDir,
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

  server.registerTool(
    'mcplab_list_runs',
    {
      description:
        'List MCPLab run artifact directories and optionally summarize each run from results.json when present.',
      inputSchema: {
        runs_dir: z.string().optional().describe('Runs directory (default mcplab/runs).'),
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
    async ({ runs_dir, limit, include_summary }) => {
      return withToolHandling(async () => {
        const base = resolve(runs_dir ?? 'mcplab/runs');
        const entries = listRuns(base, limit ?? 10, Boolean(include_summary));
        return ok(`Found ${entries.length} run(s) in ${base}`, {
          runsDir: base,
          runs: entries
        });
      });
    }
  );

  server.registerTool(
    'mcplab_list_tool_analysis_results',
    {
      description:
        'List saved MCP tool analysis reports persisted by the MCPLab app (default: mcplab/tool-analysis-results).',
      inputSchema: {
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
    async ({ tool_analysis_results_dir, limit }) => {
      return withToolHandling(async () => {
        const baseDir = resolveToolAnalysisResultsDir(tool_analysis_results_dir);
        const reports = listToolAnalysisReportsFromDisk(baseDir, limit ?? 20);
        return ok(`Found ${reports.length} tool analysis report(s) in ${baseDir}`, {
          tool_analysis_results_dir: baseDir,
          items: reports
        });
      });
    }
  );

  server.registerTool(
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
          report_id === 'LATEST' ? latestToolAnalysisReportId(baseDir) : report_id.trim();
        if (!resolvedReportId) {
          throw new Error(`No tool analysis reports found in ${baseDir}`);
        }
        const filePath = toolAnalysisReportFilePath(baseDir, resolvedReportId);
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

  server.registerTool(
    'mcplab_delete_tool_analysis_result',
    {
      description:
        'Delete a saved MCP tool analysis report directory by report id (from mcplab/tool-analysis-results by default).',
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
        const dirPath = toolAnalysisReportDirPath(baseDir, report_id.trim());
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

  server.registerTool(
    'mcplab_read_run_artifact',
    {
      description:
        'Read MCPLab run artifacts such as results.json, summary.md, trace.jsonl, resolved-config.yaml, or report.html.',
      inputSchema: {
        runs_dir: z.string().optional().describe('Runs directory (default mcplab/runs).'),
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
          .describe('Optional content truncation limit.')
      }
    },
    async ({ runs_dir, run_id, artifact, max_chars }) => {
      return withToolHandling(async () => {
        const base = resolve(runs_dir ?? 'mcplab/runs');
        const resolvedRunId = run_id === 'LATEST' ? latestRunId(base) : run_id;
        if (!resolvedRunId) {
          throw new Error(`No runs found in ${base}`);
        }
        const fullPath = join(base, resolvedRunId, artifact);
        if (!existsSync(fullPath)) {
          throw new Error(`Artifact not found: ${fullPath}`);
        }
        const raw = readFileSync(fullPath, 'utf8');
        const content = truncate(raw, max_chars ?? 20_000);
        const structured: Record<string, unknown> = {
          path: fullPath,
          run_id: resolvedRunId,
          artifact,
          truncated: content.length < raw.length,
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
    ? ((parseYaml(readFileSync(serversPath, 'utf8')) as Record<string, unknown>) ?? {})
    : {};
  const agents = existsSync(agentsPath)
    ? ((parseYaml(readFileSync(agentsPath, 'utf8')) as Record<string, unknown>) ?? {})
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
  auth_type?: 'none' | 'bearer' | 'oauth_client_credentials';
  bearer_env?: string;
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
    if (!input.bearer_env) {
      throw new Error('bearer_env is required when auth_type=bearer');
    }
    return {
      transport,
      url: input.url,
      auth: {
        type: 'bearer',
        env: input.bearer_env
      }
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
  if (!existsSync(runsDir)) return undefined;
  return readdirSync(runsDir)
    .filter((name) => {
      try {
        return statSync(join(runsDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse()[0];
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
  return resolvePathInsideWorkspace(input?.trim() ? input : 'mcplab/tool-analysis-results');
}

function toolAnalysisReportDirPath(baseDir: string, reportId: string): string {
  const trimmed = reportId.trim();
  if (!trimmed) throw new Error('report_id is required');
  return resolvePathInsideWorkspace(join(baseDir, trimmed));
}

function toolAnalysisReportFilePath(baseDir: string, reportId: string): string {
  return resolvePathInsideWorkspace(join(toolAnalysisReportDirPath(baseDir, reportId), 'report.json'));
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
      out.push({ report_id: reportId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
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
