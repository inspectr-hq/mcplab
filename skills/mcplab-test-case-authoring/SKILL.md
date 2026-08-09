---
name: mcplab-test-case-authoring
description: Operator guide for authoring MCPLab Test Cases and evaluation configuration YAML. Use when users need to create or edit Test Cases, build a new evaluation config, generate MCP server/agent/scenario library entries, or need OAuth/bearer auth config guidance. Prefer MCP tools (`mcplab_create_test_case`, `mcplab_create_evaluation_config`, `mcplab_generate_scenario_entry`, `mcplab_generate_server_entry`, `mcplab_generate_agent_entry`, `mcplab_validate_config`) when available; otherwise hand-author YAML using these patterns. For running evaluations, troubleshooting failures, or analyzing results, use skill `mcplab-assistant` instead.
---

# MCPLab Test Case Authoring

## Overview

Use this skill to create and edit MCPLab Test Cases and evaluation configuration YAML: new configs, reusable library Test Cases, MCP server entries, agent entries, and auth setup. Stay in authoring scope only — for execution, troubleshooting, and results analysis, switch to skill `mcplab-assistant`.

## Execution Policy

1. Keep config authoring and validation in the MCP flow when possible (`mcplab_generate_*`, `mcplab_create_test_case`, `mcplab_create_evaluation_config`, `mcplab_validate_config`).
2. When MCP tools are unavailable, hand-author YAML using the patterns below and validate the shape against `config-schema.json`.

## Reference

- Config patterns: `references/config-recipes.md`

## Assistant Mode

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

## Source Of Truth

- Config schema: `config-schema.json`

## Concrete Request Patterns

### Pattern 1: OAuth Config Request

User request:
"Help me write mcplab eval YAML with OAuth auth."

Assistant behavior:
1. Provide minimal valid YAML with `agents`, `scenarios`, and scenario-scoped `mcp_servers`.
2. Use `auth.type: oauth_client_credentials` with `token_url`, `client_id_env`, and `client_secret_env`.
3. List required env var names and provide one `mcplab run -c ...` verification command.
