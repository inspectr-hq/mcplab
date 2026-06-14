# MCPLab Architecture

MCPLab is a self-contained evaluation framework for MCP (Model Context Protocol) servers. It runs LLM agents against MCP servers, asserts on tool usage and responses, captures detailed traces, and surfaces results through a web UI.

---

## Monorepo Layout

```
/
├── packages/
│   ├── core/          — evaluation engine (shared library)
│   ├── cli/           — CLI binary + app server
│   ├── app/           — React web frontend
│   ├── mcp-server/    — MCP server exposing evaluation data
│   └── reporting/     — HTML report generator
├── mcplab/            — local user workspace (configs, results)
│   ├── agents.yaml    — agent library (reusable LLM configs)
│   ├── servers.yaml   — server library (reusable MCP server configs)
│   ├── evals/         — evaluation config YAML files
│   ├── test-cases/    — reusable scenario definitions
│   └── results/
│       └── evaluation-runs/   — run output (results, traces, reports)
└── package.json       — npm workspaces root
```

All packages are ESM TypeScript, built with `tsc -b` (project references).

---

## Layer Overview

```
┌──────────────────────────────────────────────┐
│           React Frontend (app/)              │
│  configs · runs · results · assistants       │
└─────────────────────┬────────────────────────┘
           REST + SSE │
┌─────────────────────▼────────────────────────┐
│        App Server  (cli/app-server/)         │
│  router · job queue · stores · OAuth         │
└────────┬────────────┬───────────┬────────────┘
         │            │           │
    ┌────▼───┐  ┌─────▼───┐  ┌───▼──────┐
    │Config  │  │  Run     │  │ Results  │
    │Store   │  │  Queue   │  │ Store    │
    │(YAML)  │  │ Service  │  │ (JSON)   │
    └────────┘  └────┬─────┘  └──────────┘
                     │ executes
┌────────────────────▼─────────────────────────┐
│       Core Engine  (core/)                   │
│  config · runner · agent adapters · mcp      │
└────────┬─────────────────────┬───────────────┘
         │                     │
┌────────▼────────┐   ┌────────▼────────┐
│  LLM Providers  │   │  MCP Servers    │
│  Anthropic      │   │  (HTTP SSE)     │
│  OpenAI         │   │                 │
│  Azure OpenAI   │   │                 │
└─────────────────┘   └─────────────────┘
```

---

## Packages

### `@inspectr/mcplab-core` (packages/core/)

The evaluation engine. Has no HTTP server of its own — it's a pure library imported by the CLI and app server.

**Responsibilities:**
- Parse and validate YAML configs (`config.ts`)
- Resolve library references (agents, servers) into fully-inlined configs
- Manage MCP client connections (`mcp.ts`, `McpClientManager`)
- Adapt LLM providers into a common chat interface (`agent.ts`)
- Run the agentic evaluation loop (`runner.ts` → `runAll`)
- Evaluate assertions: tool constraints, response assertions, agent (judge) checks
- Aggregate per-run results into `ResultsJson`
- Render markdown summaries

### `@inspectr/mcplab` (packages/cli/)

The CLI binary and interactive app server.

**CLI commands:**
- `mcplab run` — load config, call `runAll`, write results to disk, print summary
- `mcplab app` — start app server + serve the React SPA

**App server** is a lightweight Node.js HTTP router (no Express) with these route groups:

| Route prefix | Domain | Notes |
|---|---|---|
| `/api/configs` | Config CRUD | reads/writes YAML files |
| `/api/runs` | Execution queue | enqueue, status, results |
| `/api/results` | Results browser | list, drill-down, trace |
| `/api/assistants` | AI assistants | scenario design + result analysis |
| `/api/oauth` | OAuth debugger | simulate provider for testing |
| `/api/tool-analysis` | Tool quality audit | inspect MCP server tools |
| `/sse/queue` | SSE event stream | live progress to UI |

### `@inspectr/mcplab-app` (packages/app/)

React 18 SPA, built with Vite and served as static files by the app server.

**Tech:** Vite · TypeScript · TailwindCSS · shadcn/ui · React Query · React Router

**Pages:**
- Configurations — browse and edit YAML eval configs
- Servers / Agents / Test Cases — manage library entries
- Run Evaluation — trigger runs, watch progress via SSE
- Results — browse runs, filter, drill into traces
- Compare — side-by-side run comparison
- Tool Analysis — MCP tool quality audit
- OAuth Debugger — interactive OAuth flow testing
- Scenario / Result Assistants — AI chat for designing and analyzing evals
- Markdown Reports — custom notes per run

### `@inspectr/mcplab-mcp-server` (packages/mcp-server/)

An MCP server that exposes MCPLab evaluation data (runs, results, traces) as MCP tools. Allows external LLM agents or tools to query evaluation history.

### `@inspectr/mcplab-reporting` (packages/reporting/)

Generates self-contained interactive HTML reports from `results.json`. Used by both the CLI (`mcplab run`) and the app server after a run completes.

---

## Key Data Models

### Config layer

```typescript
// Parsed from YAML, stored in mcplab/evals/*.yaml
EvalConfig {
  name?: string
  servers: Record<string, ServerConfig>     // MCP server definitions
  agents:  Record<string, AgentConfig>      // LLM agent definitions
  scenarios: Scenario[]
}

AgentConfig {
  provider: 'anthropic' | 'openai' | 'azure_openai'
  model: string
  temperature?, max_tokens?, max_turns?, system?
}

ServerConfig {
  transport: 'http'
  url: string
  headers?: Record<string, string>
  auth?: BearerAuth | ApiKeyAuth | OAuthClientCredentials | OAuthAuthzCode
}

Scenario {
  id, name, prompt
  servers: string[]          // server IDs to connect
  eval?: {
    tool_constraints?        // required/forbidden tools, call counts
    tool_sequence?           // expected ordered sequence of tool calls
    response_assertions?     // regex / substring matches on final answer
    agent_assertions?        // LLM-as-judge checks with context
  }
  extract?: ExtractRule[]    // regex extractions from final answer
}
```

### Execution layer

```typescript
ScenarioRunResult {
  run_index, pass, error?, failures[]
  check_results              // per-assertion pass/fail
  tool_calls, tool_call_count, tool_sequence
  tool_usage, tool_durations_ms, run_duration_ms
  final_text
  extracted                  // values from ExtractRule[]
}

ScenarioAggregate {
  scenario_id, agent, provider, model
  runs: ScenarioRunResult[]
  pass_rate, distinct_sequences
  tool_usage_frequency, extracted_values
  last_final_answer
}

ResultsJson {
  metadata: { run_id, timestamp, config_hash, cli_version, ... }
  summary:  { total_scenarios, total_runs, pass_rate, avg_tool_calls, avg_latency }
  scenarios: ScenarioAggregate[]
}
```

### Trace layer

```typescript
// Appended to trace.jsonl one record per scenario run
ScenarioRunTraceRecord {
  type: 'scenario_run'
  scenario_id, agent, provider, model
  ts_start, ts_end, pass, error?
  messages: TraceMessage[]
  metrics: { tool_call_count, total_tool_duration_ms }
}

TraceMessage {
  role: 'user' | 'assistant' | 'tool'
  ts?, usage?
  content: (
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id, name, input, server }
    | { type: 'tool_result'; id, content, is_error }
  )[]
}
```

---

## Data Flows

### 1. Evaluation run (via UI)

```
User clicks "Run"
  → POST /api/runs/queue  (config path + options)
    → RunQueueService.enqueue(job)
      → SSE event: { status: 'queued' }

Worker picks up job
  → SSE event: { status: 'running' }
  → core.runAll(resolvedConfig)
    → McpClientManager: HTTP connect to each MCP server
    → For each scenario × agent:
        1. Build tool list from MCP servers
        2. Send prompt + tools to LLM (Anthropic/OpenAI/Azure)
        3. LLM responds with tool_use → invoke via MCP → feed result back
        4. Repeat until max_turns or final text answer
        5. Evaluate assertions (tool_constraints, response, agent checks)
        6. Append ScenarioRunTraceRecord to trace.jsonl
    → Aggregate ScenarioRunResult[] → ResultsJson
    → Write: results.json, trace.jsonl, report.html, summary.md, resolved-config.yaml

  → SSE event: { status: 'finished', run_id }
  → UI navigates to Results page
```

### 2. Evaluation run (via CLI)

```
mcplab run --config evals/my-eval.yaml
  → Load + resolve YAML config
  → core.runAll(config)          (same engine as above)
  → Write results to disk
  → Print markdown summary
  → Exit
```

### 3. Config resolution

```
Raw YAML file
  → parse YAML → SourceEvalConfig
  → load agents.yaml + servers.yaml libraries
  → replace $ref strings with full inline definitions
  → compute SHA-256 hash of resolved config
  → return EvalConfig (fully resolved, ready for execution)
```

### 4. Results query

```
GET /api/results
  → runs-store.listRuns()
    → scan evaluation-runs/ directory
    → read results.json per run
    → return run list with summaries

GET /api/results/:runId/trace/:scenarioId
  → runs-store.getScenarioRunTraceRecords(runId, scenarioId)
    → stream trace.jsonl, filter by scenario
    → return matching ScenarioRunTraceRecord[]
```

### 5. OAuth flow (runtime)

```
Run job starts
  → OAuthSessionManager.ensureServersReady(serverConfigs)
    → For each server with OAuth auth:
        If valid cached token → use it
        If expired → refresh (with clock skew buffer)
        If no token → throw OAuthAuthorizationRequiredError

App server catches OAuthAuthorizationRequiredError
  → SSE event: { status: 'auth_required', server, authUrl }
  → UI opens browser tab for user to authorize
  → Callback hits /api/oauth/callback
  → Token stored in OAuthSessionManager
  → Run job resumes
```

### 6. Agent (judge) assertion

```
Scenario has agent_assertion: { prompt: "Did the agent correctly..." }

After scenario run completes:
  → Build judge context:
      - scenario prompt
      - final answer from agent
      - tool call history
      - any custom context fields
  → Send judge prompt + context to LLM (configured judge model)
  → LLM responds with { pass: boolean, reason: string }
  → Record as check_result in ScenarioRunResult
```

---

## Storage

MCPLab uses the **filesystem only** — no database.

| Data | Location | Format |
|---|---|---|
| Eval configs | `mcplab/evals/*.yaml` | YAML |
| Agent library | `mcplab/agents.yaml` | YAML |
| Server library | `mcplab/servers.yaml` | YAML |
| App settings | `mcplab/.mcplab-app-settings.yaml` | YAML |
| Run results | `mcplab/results/evaluation-runs/{run-id}/results.json` | JSON |
| Run traces | `mcplab/results/evaluation-runs/{run-id}/trace.jsonl` | NDJSON |
| HTML report | `mcplab/results/evaluation-runs/{run-id}/report.html` | HTML |
| Resolved config | `mcplab/results/evaluation-runs/{run-id}/resolved-config.yaml` | YAML |
| Search index | `mcplab/results/.index/` | On-demand index files |

**In-memory only (lost on restart):**
- Job queue state
- OAuth tokens
- Assistant sessions
- Tool analysis cache
- MCP client connections

---

## Authentication

### LLM API keys
Sourced from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY`). Passed directly to the respective SDKs.

### MCP server authentication
Configured per-server in YAML. Env var references (`${MY_VAR}`) are resolved at runtime.

| Auth type | How it works |
|---|---|
| `bearer` | Static token in `Authorization: Bearer` header |
| `api_key` | Custom header name + value |
| `oauth_client_credentials` | Token fetched from `token_url` using `client_id` + `client_secret`; cached and refreshed automatically |
| `oauth_authz_code` | User-delegated flow; optional DCR (Dynamic Client Registration); managed by `OAuthSessionManager` |

---

## External Services & Protocols

| Service | SDK / Protocol | Purpose |
|---|---|---|
| Anthropic API | `@anthropic-ai/sdk` | Claude models (Opus, Sonnet, Haiku) |
| OpenAI API | `openai` | GPT-4o, GPT-4-turbo |
| Azure OpenAI | `openai` (Azure mode) | Enterprise GPT deployments |
| MCP servers | `@modelcontextprotocol/sdk` (StreamableHTTP) | Tool invocation against the servers under test |
| OAuth 2.0 providers | Built-in HTTP client | Token acquisition for MCP server auth |

---

## Configuration Reference

**App settings** (`mcplab/.mcplab-app-settings.yaml`):
```yaml
defaultQueueWorkers: 2   # parallel evaluation jobs
```

**Agent config** (in `agents.yaml` or inline in eval YAML):
```yaml
my-agent:
  provider: anthropic
  model: claude-sonnet-4-6
  max_turns: 10
  temperature: 0
```

**Server config** (in `servers.yaml` or inline):
```yaml
my-server:
  transport: http
  url: https://my-mcp-server.example.com/mcp
  auth:
    type: bearer
    token: ${MY_SERVER_TOKEN}
```

**Scenario eval config** (in `evals/*.yaml`):
```yaml
name: My Eval
agents: { default: $ref(agents.yaml#my-agent) }
servers: { api: $ref(servers.yaml#my-server) }
scenarios:
  - id: scenario-1
    name: Basic tool call
    servers: [api]
    agent: default
    prompt: "Fetch the current weather for Amsterdam"
    eval:
      tool_constraints:
        required: [get_weather]
      response_assertions:
        - contains: "Amsterdam"
```
