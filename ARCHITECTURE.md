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

## Domain Models: Runner, Evaluation & Storage in Depth

This section explains how the core domain objects relate to each other and traces the lifecycle of a single evaluation run through all three subsystems.

### Object lifecycle overview

```
YAML file on disk
  │
  ▼ loadConfig()
SourceEvalConfig          ← raw, preserves $ref strings
  │
  ▼ resolveReferences()
EvalConfig                ← fully inlined servers + agents + scenarios
  │
  ▼ expandConfigForAgents()
ExecutableEvalConfig      ← one ExecutableScenario per scenario × agent
  │
  ▼ runAll()  ──────────────────────────────────────────────┐
  │                                                         │
  │  for each ExecutableScenario × run_index               │
  │    │                                                   │
  │    ▼ runAgentScenario()                                │
  │  TraceMessage[]          ← turn-by-turn conversation   │
  │    │                                                   │
  │    ▼ evaluateScenario()                                │
  │  EvalResult              ← pass/fail + check_results   │
  │    │                                                   │
  │    ▼ build ScenarioRunResult                           │
  │  ScenarioRunResult       ← one record per run attempt  │
  │    │  (written live to trace.jsonl)                    │
  │    ▼                                                   │
  │  ScenarioAggregate       ← aggregated across N runs    │
  │                                                        │
  └──────────── ResultsJson ◄──────────────────────────────┘
                  │
                  ▼ write to disk
            results.json · trace.jsonl · report.html · summary.md
```

---

### 1. Config domain

Config objects move through three transformations before execution is possible.

**`SourceEvalConfig`** — what the YAML file literally contains. May have `$ref(agents.yaml#my-agent)` strings, scenario lists as file paths, or objects instead of arrays. This is never used for execution.

**`EvalConfig`** — the resolved form. All `$ref` strings are expanded inline. Library entries from `agents.yaml` and `servers.yaml` are merged in. Scenario YAML files are loaded and inlined. A SHA-256 hash of the stable-stringified object is computed and stored alongside (`config_hash` in `ResultsJson.metadata`), allowing two results to be compared for config equality.

**`ExecutableEvalConfig`** — produced by `expandConfigForAgents()`. Flattens the scenario × agent matrix: if a scenario has two agents selected, it becomes two `ExecutableScenario` objects, each with a concrete `agent` ID bound. This is the shape the runner iterates over.

```
EvalConfig.scenarios × EvalConfig.run_defaults.selected_agents
  → ExecutableScenario[]
     { ...Scenario, agent: 'my-agent', scenario_exec_id: 'scenario-1::my-agent' }
```

---

### 2. Runner domain (`runAll`)

`runAll` in `packages/core/src/runner.ts` is the top-level orchestrator. It owns the run directory, connects MCP clients, iterates the scenario matrix, and writes every output file.

**Phases:**

**Setup**
- Creates the run directory (`{runsDir}/{runId}/`)
- Writes `resolved-config.yaml` immediately (before any scenarios run)
- Initialises `trace.jsonl` with a metadata header line

**MCP connection**
- Calls `McpClientManager.connectAll(servers)` for every server referenced across all scenarios
- Resolves auth headers from env vars or the OAuth session manager
- Retries up to 3 times with 250 ms backoff per server
- After this point, `McpClientManager.getClient(serverName)` returns a ready client for the rest of the run

**Scenario loop**
For every `ExecutableScenario` and every run index (1 … `runsPerScenario`):
1. Calls `runAgentScenario()` → returns `TraceMessage[]` + metadata
2. Calls `evaluateScenarioWithAgentChecks()` → returns `EvalResult`
3. Calls `extractValues()` for any `extract` rules
4. Assembles `ScenarioRunResult`
5. Appends `ScenarioRunTraceRecord` to `trace.jsonl` (append, not rewrite — survives partial runs)
6. Emits progress events to the queue SSE stream

**Aggregation & output**
- Groups `ScenarioRunResult[]` by `scenario_exec_id` → `ScenarioAggregate[]`
- Computes `pass_rate`, `distinct_sequences`, `tool_usage_frequency`, `extracted_values`
- Writes `results.json` (full `ResultsJson`)
- Writes `summary.md` (markdown table)
- Triggers `reporting` package to write `report.html`

---

### 3. Agent execution domain (`runAgentScenario`)

Implements the agentic tool-use loop inside `packages/core/src/agent.ts`.

```
Initial messages: [ { role: 'user', content: scenario.prompt } ]

Loop (up to max_turns, default 30):
  │
  ├─ send messages + tool definitions → LLM adapter
  │
  ├─ LLM responds with tool_use blocks?
  │   YES → for each tool_use:
  │           resolve tool → server name
  │           McpClientManager.callTool(server, tool, args)
  │           record { tool_name, server, duration_ms, result }
  │           append tool_result message
  │         continue loop
  │
  └─ LLM responds with text only?
        → final_text captured
        → break
```

**LLM adapters** implement a common `ChatAdapter` interface:

| Provider | Adapter | SDK |
|---|---|---|
| `anthropic` | `AnthropicAdapter` | `@anthropic-ai/sdk` |
| `openai` | `OpenAiAdapter` | `openai` |
| `azure_openai` | `AzureOpenAiAdapter` | `openai` (Azure mode) |

All adapters normalise to the same internal `LlmMessage` / `LlmResponse` types so the loop code is provider-agnostic.

**Tool registry** — at the start of each scenario, `McpClientManager.listTools(serverName)` is called for each connected server. Tools are merged into a flat registry keyed by `tool_name → server_name`, which the loop uses to route tool calls.

**Scoped MCP clients** — if a scenario injects per-call headers (e.g. a user identity), `McpClientManager` creates a separate client instance for that header set (LRU-evicted, up to `maxScopedClients`). This prevents header cross-contamination between concurrent runs.

---

### 4. Evaluation domain (`evaluateScenario`)

Evaluation in `packages/core/src/eval.ts` runs four check layers in order. Each layer produces `CheckResult[]` entries that accumulate into `EvalResult.check_results`.

```
evaluateScenario(finalText, toolSequence, evalRules)
  │
  ├─ 1. Tool constraints
  │       required_tools   → did these tool names appear in toolSequence?
  │       forbidden_tools  → did any of these appear? (must not)
  │
  ├─ 2. Tool sequence
  │       ordered tool list  → do the listed tools appear in the same order?
  │       (subsequence match; other tools may appear in between)
  │
  ├─ 3. Response assertions  (each produces one CheckResult)
  │       regex             → RegExp.test(finalText)  (case-insensitive, inline flags stripped)
  │       contains          → finalText.includes(value)
  │       not_contains      → !finalText.includes(value)
  │       starts_with       → finalText.startsWith(value)
  │       ends_with         → finalText.endsWith(value)
  │       equals            → finalText === value
  │       jsonpath          → JSONPath query result matches expected value
  │       jsonpath_exists   → JSONPath query returns at least one result
  │       jsonpath_not_exists → JSONPath query returns nothing
  │
  └─ 4. Agent assertions   (LLM-as-judge — async, batched)
          Build judge context (configurable via agent_context):
            include_prompt?        → prepend scenario prompt
            include_tool_sequence? → prepend tool call history
            extra fields?          → prepend any user-defined key/value pairs
          Single LLM call with all assertions in one batch:
            system: "You are an evaluation judge..."
            user:   JSON array of { id, prompt, context }
          Expected response: { results: [{ id, pass, reason }] }
          Each result → one CheckResult
```

A scenario `pass`es only when **all** check layers produce no failures.

**`EvalResult`** is the output:

```typescript
EvalResult {
  pass: boolean
  failures: string[]        // human-readable failure messages
  check_results: CheckResult[]
}

CheckResult {
  id: string                // assertion id or tool name
  label?: string            // display label
  status: 'passed' | 'failed' | 'not_evaluated'
  reason?: string           // judge reason, or failure detail
}
```

---

### 5. Storage domain

Storage in MCPLab is pure filesystem — no database, no migration tooling.

#### Config storage (read/write)

Files are written and read as YAML by the app server's config store. The UI sends JSON to `/api/configs`; the server serialises to YAML and writes back to disk. `loadConfig()` re-parses on every request (no in-memory cache) so changes on disk are always visible.

```
mcplab/
  agents.yaml             ← agent library (all reusable agent defs)
  servers.yaml            ← server library (all reusable server defs)
  evals/
    my-eval.yaml          ← individual eval config (may $ref library entries)
  test-cases/
    search/
      basic.yaml          ← reusable scenario definitions (included via $ref)
```

#### Run storage (write-once)

The runner writes a new directory per run. Files are written in this order:

```
results/evaluation-runs/{run-id}/
  resolved-config.yaml    ← written first (before any scenarios run)
  trace.jsonl             ← appended per scenario run (survives partial runs)
  results.json            ← written last (complete aggregated results)
  summary.md              ← written after results.json
  report.html             ← written after results.json (by reporting package)
```

`trace.jsonl` uses newline-delimited JSON. The first line is a metadata record; each subsequent line is one `ScenarioRunTraceRecord`. Because it is appended incrementally, a crashed run still has all traces up to the point of failure, even if `results.json` is absent or incomplete.

#### Run query (read-only)

The app server's `runs-store.ts` never modifies the run directory.

```
listRuns(runsDir, filter?)
  → fs.readdir(runsDir)
  → for each subdir: read results.json → extract metadata + summary
  → sort by timestamp desc
  → apply filter (since/until/lastDays/scenario)
  → return RunSummary[]

getRunResults(runId, runsDir)
  → read {runId}/results.json
  → return ResultsJson

getScenarioRunTraceRecords(runId, runsDir)
  → open {runId}/trace.jsonl
  → readline stream: parse each line, filter type === 'scenario_run'
  → return ScenarioRunTraceRecord[]
```

#### In-memory state (ephemeral)

These exist only for the lifetime of the app server process:

| State | Owner | Notes |
|---|---|---|
| Job queue | `RunQueueService` | Jobs lost on restart; results on disk are still readable |
| OAuth tokens | `OAuthSessionManager` | Must re-authenticate after restart |
| MCP connections | `McpClientManager` | Re-established at the start of each run |
| Assistant sessions | assistant domain | Cleaned up after idle timeout |
| Tool analysis cache | tool-analysis domain | Rebuilt on next request |

---

### 6. Run queue domain

The queue bridges the app server (HTTP) and the core engine (pure TS library). It is the only place where concurrency is managed.

```
Job lifecycle:
  queued → [blocked_auth] → admitting → running → completed
                                                 → error
                                                 → stopped
```

**`RunQueueService`** maintains a list of jobs and a worker pool. `enqueueRun()` adds a job and calls `advance()`. `advance()` claims the next queued (or unblocked) job up to the configured `workerCount`, marks it `admitting`, resolves OAuth if needed (may transition to `blocked_auth`), then kicks off `runAll()` in the background.

SSE subscribers receive every state transition and log event in real time via `/sse/queue`. The UI uses these to update progress indicators without polling.

**OAuth blocking** — if `OAuthSessionManager.ensureServersReady()` throws `OAuthAuthorizationRequiredError`, the job transitions to `blocked_auth` and emits an SSE event containing the authorization URL. The UI opens the browser. Once the user completes the OAuth flow and the token is stored, `resumeBlockedJobs()` re-runs `advance()` for that job.

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

### LangSmith tracing (optional)

When `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` are configured, `packages/core` exports evaluation traces through the LangSmith TypeScript SDK. Each scenario execution is a `chain` parent with nested `llm` provider calls and `tool` MCP calls. `LANGSMITH_ENDPOINT`, `LANGSMITH_PROJECT`, and `LANGSMITH_WORKSPACE_ID` support regional, self-hosted, project, and multi-workspace configurations. Export failures are warnings only; filesystem artifacts remain authoritative.

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
