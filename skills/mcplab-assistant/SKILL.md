---
name: mcplab-assistant
description: Operator guide for MCPLab config authoring and CLI usage. Use when users need help writing or debugging MCPLab eval YAML, running `mcplab run/app/report`, troubleshooting run failures (auth, config, scenario selection, numeric flags), interpreting outputs in `mcplab/results/evaluation-runs/*` (`results.json`, `summary.md`, `trace.jsonl`, `report.html`), or comparing agent performance with `--agents`.
---

# MCPLab Assistant

## Overview

Use this skill to operate MCPLab evaluations end-to-end: create or update configs, run scenarios, diagnose failures, and analyze outputs.
Stay in operator scope only. Do not include repository build/setup instructions.

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

1. Read artifacts in this order:
- `results.json`
- `summary.md`
- `trace.jsonl` (for failing scenarios or unclear tool behavior)
- `report.html` (optional, interactive confirmation)
2. Return analysis with:
- overall pass/fail summary
- failing scenario IDs and failure reason category
- tool-usage observations (missing required tools, forbidden tool usage, sequence drift)
- concrete remediation steps per failing scenario
3. For multi-agent runs, include side-by-side comparison:
- pass rate per agent
- median/typical latency
- scenario-level win/loss notes
4. Always reference exact artifact paths and scenario IDs in findings.

## Config Workflow

1. Start from the smallest valid skeleton (`agents`, `scenarios`).
2. Add explicit scenario MCP connectivity with `scenarios[].mcp_servers` entries (`ref` or inline server object).
3. Add one working agent, then add variants if needed.
4. Add scenarios with:
- unique kebab-case `id`
- optional `agent` key when scenario should pin to one model
- at least one `servers` entry (labels available to the scenario)
- `prompt`
5. Add optional `eval` and `extract` blocks after baseline run succeeds.
6. Validate references and shape against `config-schema.json`.
7. Prefer minimal deterministic edits over large rewrites.

## CLI Workflow

1. Choose command by intent:
- Execute evaluations -> `mcplab run`
- Open local UI/API bridge -> `mcplab app`
- Rebuild HTML report from existing run -> `mcplab report`
2. Use only documented flags from CLI source.
3. For model comparison, use `mcplab run --agents ...`.
4. If a run fails, capture exact error and switch to troubleshooting workflow.

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

1. Read run directory artifacts:
- `results.json` for structured metrics and pass/fail
- `summary.md` for quick human scan
- `trace.jsonl` for call-by-call debugging
- `report.html` for interactive investigation
2. For multi-agent runs, compare by pass rate, tool efficiency, and latency.
3. Highlight regressions with concrete scenario IDs and observed behavior deltas.

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
2. Provide one follow-up analysis step using `results.json` and `report.html`.

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
1. Read `results.json` first and list failing scenario IDs.
2. Use `summary.md` for quick trend context.
3. Use `trace.jsonl` only for failed/ambiguous scenarios to explain root cause.
4. Return actionable fixes mapped scenario-by-scenario, with rerun command.
