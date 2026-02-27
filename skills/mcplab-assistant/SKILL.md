---
name: mcplab-assistant
description: Operator guide for MCPLab config authoring and CLI usage. Use when users need help writing or debugging MCPLab eval YAML, running `mcplab run/watch/app/report`, troubleshooting run failures (auth, config, scenario selection, numeric flags), interpreting outputs in `runs/*` (`results.json`, `summary.md`, `trace.jsonl`, `report.html`), or comparing agent performance with `--agents`.
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

## Config Workflow

1. Start from the smallest valid skeleton (`servers`, `agents`, `scenarios`).
2. Apply the schema contract from `references/config-recipes.md` ("Schema Contract").
3. Add server definitions and auth mode (`bearer` or `oauth_client_credentials`).
4. Add one working agent, then add variants if needed.
5. Add scenarios with:
- unique kebab-case `id`
- valid `agent` key reference
- at least one `servers` entry
- `prompt`
6. Add optional `eval` and `extract` blocks after baseline run succeeds.
7. Validate references and shape against `config-schema.json`.
8. Prefer minimal deterministic edits over large rewrites.

## CLI Workflow

1. Choose command by intent:
- Execute evaluations -> `mcplab run`
- Re-run on config changes -> `mcplab watch`
- Open local UI/API bridge -> `mcplab app`
- Rebuild HTML report from existing run -> `mcplab report`
2. Use only documented flags from CLI source.
3. For model comparison, use `mcplab run --agents ...` (not `watch`).
4. If a run fails, capture exact error and switch to troubleshooting workflow.

## Troubleshooting Workflow

1. Match error to category:
- Connectivity/auth (`fetch failed`, missing token/env)
- Config reference mismatch (unknown agent/server/scenario linkage)
- Invalid numeric options (`--runs`, `--port`, `--debounce`)
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
- Usage examples: `examples/*.yaml` and `README.md`

## Concrete Request Patterns

### Pattern 1: OAuth Config Request

User request:
"Help me write mcplab eval YAML with OAuth auth."

Assistant behavior:
1. Provide minimal valid YAML with `servers`, `agents`, and `scenarios`.
2. Use `auth.type: oauth_client_credentials` with `token_url`, `client_id_env`, and `client_secret_env`.
3. List required env var names and provide one `mcplab run -c ...` verification command.

### Pattern 2: CLI Comparison Request

User request:
"How do I run watch mode and compare agents?"

Assistant behavior:
1. Clarify that comparison uses `mcplab run --agents ...`, not `watch`.
2. Provide one `watch` command for iterative single-agent config tuning.
3. Provide one `run --agents` command for comparison and one follow-up analysis step (`results.json`/`report.html`).

### Pattern 3: Failure Triage Request

User request:
"My run fails with fetch failed."

Assistant behavior:
1. Ask for exact command, relevant server config block, and error text.
2. Check URL reachability, auth env variable names, and server auth mode match.
3. Provide smallest retry command (`mcplab run -c ... -s ... -n 1`) and next artifact to inspect (`trace.jsonl`).
