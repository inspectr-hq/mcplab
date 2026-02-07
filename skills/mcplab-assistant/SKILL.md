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

## Config Workflow

1. Start from the smallest valid skeleton (`servers`, `agents`, `scenarios`).
2. Add server definitions and auth mode (`bearer` or `oauth_client_credentials`).
3. Add one working agent, then add variants if needed.
4. Add scenarios with:
- unique kebab-case `id`
- valid `agent` key reference
- at least one `servers` entry
- `prompt`
5. Add optional `eval` and `extract` blocks after baseline run succeeds.
6. Validate references and shape against `config-schema.json`.
7. Prefer minimal deterministic edits over large rewrites.

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
