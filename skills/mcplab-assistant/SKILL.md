---
name: mcplab-assistant
description: Operator guide for MCPLab config authoring and execution workflows. Use when users need help writing or debugging MCPLab eval YAML, running scenarios (prefer MCP tool `mcplab_run_eval` when available; CLI fallback `mcplab run/app/report/results`), troubleshooting run failures (auth, config, scenario selection, numeric flags), interpreting outputs in `mcplab/results/evaluation-runs/*` (`results.json`, `summary.md`, `trace.jsonl`, `report.html`), or comparing agent performance with `--agents`.
---

# MCPLab Assistant

## Overview

Use this skill to operate MCPLab evaluations end-to-end: create or update configs, run scenarios, diagnose failures, and analyze outputs.
Stay in operator scope only. Do not include repository build/setup instructions.

## Execution Policy

1. When MCP tools are available, execute scenarios with `mcplab_run_eval` first.
2. Use CLI commands (`mcplab run`) as fallback when MCP tool execution is unavailable.
3. Keep config authoring and validation in MCP flow when possible (`mcplab_generate_*`, `mcplab_validate_config`).

## Workflow Router

1. Classify the request:
- Config authoring/edits -> follow "Config Workflow".
- Command execution/help -> follow "CLI Workflow".
- Failure/debugging -> follow "Troubleshooting Workflow".
- Results interpretation/comparison -> follow "Output Analysis Workflow".

2. Load only needed references:
- Config patterns: `references/config-recipes.md`
- Command patterns: `references/cli-recipes.md`
- Error diagnosis: `references/troubleshooting.md`
- Example selection: `references/examples-map.md`

## Response Template

Always structure responses in this order when helping with MCPLab operations:

1. `Intent`: one line stating what is being done (configing, running, debugging, analysis).
2. `Actions`: exact commands or config edits to apply.
3. `Verification`: how to confirm success (expected files, output lines, or pass metrics).
4. `If It Fails`: the next diagnostic step and exact artifact to inspect.

Use concrete file paths and command lines. Avoid generic advice.

## LLM Configuration Assistant Mode

When the request is about creating or editing MCPLab config, the assistant must:

1. Ask for only missing critical inputs:
- MCP endpoint URL(s)
- target agent/model(s)
- scenario intent
- auth mode (`bearer`, `oauth_client_credentials`, or `oauth_authorization_code`)
2. Produce a minimal valid config first (single scenario), then optional expansions.
3. Return copy-ready YAML plus one verification command (`mcplab run -c ...`).
4. Include a short validation checklist:
- schema shape valid
- env var names present (never values)
- scenario references resolve
5. If user provides a broken config, return the smallest patch instead of full rewrites.

## LLM Report Analysis Mode

When the request is about analyzing results, the assistant must:

1. Prefer MCP analysis tools first to reduce context/token usage:
- `mcplab_aggregate_runs` for multi-run trends and compact metric summaries
- `mcplab_compare_runs` for structured run-to-run regressions/improvements
- `mcplab_search_markdown_reports` to locate report files
- `mcplab_search_tool_analysis_results` to query stored tool analysis data
2. Read artifacts directly only when needed:
- `results.json`
- `summary.md`
- `trace.jsonl` (for failing scenarios or unclear tool behavior)
- `report.html` (optional, interactive confirmation)
3. Return analysis with:
- overall pass/fail summary
- failing scenario IDs and failure reason category
- tool-usage observations (missing required tools, forbidden tool usage, sequence drift)
- concrete remediation steps per failing scenario
4. For multi-agent runs, include side-by-side comparison:
- pass rate per agent
- median/typical latency
- scenario-level win/loss notes
5. Always reference exact artifact paths and scenario IDs in findings.

## Config Workflow

1. Start from the smallest valid skeleton (`agents`, `scenarios`).
2. Add explicit scenario MCP connectivity with `scenarios[].mcp_servers` entries (`ref` or inline server object).
3. Add one working agent, then add variants if needed.
4. Add scenarios with:
- unique kebab-case `id`
- optional `agent` key when scenario should pin to one model
- at least one `servers` entry (labels available to the scenario)
- `prompt`
5. For reusable test-cases across environments, prefer referenced scenario overlays:
- `scenarios: [{ ref: "<test-case-id>", mcp_servers: [{ ref: "<env-server-id>" }] }]`
- This keeps prompt/eval in library test-case and swaps only MCP target per eval.
6. Add optional `eval` and `extract` blocks after baseline run succeeds.
7. Prefer literal response assertions first (`contains`, `equals`, etc.), then `regex` only when variability requires it.
8. Validate references and shape against `config-schema.json`.
9. Prefer minimal deterministic edits over large rewrites.

## CLI Workflow

Use this workflow when MCP execution tools are not available or when the user explicitly asks for shell commands.

1. Choose command by intent:
- Execute evaluations -> `mcplab run`
- Open local UI/API bridge -> `mcplab app`
- Rebuild HTML report from existing run -> `mcplab report`
- Query run artifacts in LLM-friendly format -> `mcplab results`
2. Use only documented flags from CLI source.
3. For model comparison, use `mcplab run --agents ...`.
4. For runtime environment switching without YAML edits, prefer:
- `mcplab run ... --server-override-all <serverRef[,serverRef...]>`
- Add per-test exceptions with repeatable `--server-override <scenarioId>=<serverRef[,serverRef...]>`
5. Runtime server overrides are ephemeral (current run only) and do not persist to eval files.
6. If a run fails, capture exact error and switch to troubleshooting workflow.

## Troubleshooting Workflow

1. Match error to category:
- Connectivity/auth (`fetch failed`, missing token/env)
- Config reference mismatch (unknown agent/server/scenario linkage)
- Invalid numeric options (`--runs`, `--port`)
2. Apply smallest corrective change.
3. Re-run same command to verify fix.
4. If still failing, ask for:
- failing command
- relevant config snippet
- exact stderr text
- env var names used (not secret values)

## Output Analysis Workflow

1. Start with LLM-first MCP results triage:
- `mcplab_results_search` for compact candidate hits
- `mcplab_results_context` for focused excerpts
2. Use low-level artifact reads only when exact/raw evidence is required:
- `mcplab_read_run_artifact` with optional `line_start`/`line_end`
3. Then use MCP comparison tools for trend/delta analysis:
- `mcplab_aggregate_runs` for historical trends
- `mcplab_compare_runs` for deterministic run deltas
4. For multi-agent runs, compare by pass rate, tool efficiency, and latency.
5. Highlight regressions with concrete scenario IDs and observed behavior deltas.
6. When quality drift is requested, compare deterministic run metrics first, then inspect targeted artifact excerpts (`results.json`, `trace.jsonl`) for output-level drift.

Path ownership note:
MCPLab MCP tools own base directories (runs/reports/tool-analysis/library roots). Provide logical IDs and relative filenames only; do not attempt to pass root directory overrides.

## Result Assistant Scopes

The Result Assistant supports two scopes:

- `run` — analyses a single evaluation run. Accessible from the individual run detail page.
- `all_runs` — analyses historical trends across all runs. Accessible from the Results overview page.

When a user asks about analyzing results in the UI, clarify which scope applies: single-run triage uses `run`; cross-run trend analysis uses `all_runs`.

## Source Of Truth

- CLI contract: `packages/cli/src/cli.ts`
- Config schema: `config-schema.json`
- Usage examples: `README.md`

## Concrete Request Patterns

### Pattern 1: OAuth Config Request

User request:
"Help me write mcplab eval YAML with OAuth auth."

Assistant behavior:
1. Provide minimal valid YAML with `agents`, `scenarios`, and scenario-scoped `mcp_servers`.
2. Use `auth.type: oauth_client_credentials` with `token_url`, `client_id_env`, and `client_secret_env`.
3. List required env var names and provide one `mcplab run -c ...` verification command.

### Pattern 2: CLI Comparison Request

User request:
"How do I compare agents?"

Assistant behavior:
1. Provide one `mcplab run --agents ...` command for comparison.
2. Provide one follow-up analysis step using `mcplab results search ...` then `mcplab results context ...`.

### Pattern 5: Historical Trend Request

User request:
"Compare historical run quality and spot regressions."

Assistant behavior:
1. Use `mcplab_aggregate_runs` for compact trend metrics over selected runs.
2. Use `mcplab_compare_runs` to identify deterministic regressions/improvements.
3. If semantic output quality is requested, use `mcplab_results_search` then `mcplab_results_context` for representative scenario deltas; fallback to `mcplab_read_run_artifact` only if needed.
4. Return top regressions first with scenario IDs and suggested next checks.

### Pattern 3: Failure Triage Request

User request:
"My run fails with fetch failed."

Assistant behavior:
1. Ask for exact command, relevant server config block, and error text.
2. Check URL reachability, auth env variable names, and server auth mode match.
3. Provide smallest retry command (`mcplab run -c ... -s ... -n 1`) and next artifact to inspect (`trace.jsonl`).

### Pattern 4: Report Analysis Request

User request:
"Analyze this run and tell me why it failed."

Assistant behavior:
1. Start with `mcplab_results_search` to list likely failing scenarios.
2. Use `mcplab_results_context` for focused scenario evidence.
3. Use `mcplab_read_run_artifact` only when exact raw lines or full artifact slices are required.
4. Return actionable fixes mapped scenario-by-scenario, with rerun command.
