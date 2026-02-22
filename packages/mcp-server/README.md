# MCPLab MCP Server

MCP server that exposes MCPLab authoring and execution helpers for other LLM clients.

## Focus

- Generate MCPLab YAML entries for `servers`, `agents`, and especially `scenarios`
- Validate configs via `@inspectr/mcplab-core` (`loadConfig`, `selectScenarios`)
- Run evaluations and inspect run artifacts
- Provide scenario-authoring prompts for MCP-capable clients

## Run (Streamable HTTP)

```bash
npm run build -w @inspectr/mcplab-mcp-server
node packages/mcp-server/dist/index.js
```

Defaults:

- Host: `127.0.0.1`
- Port: `3011`
- MCP endpoint: `/mcp`

Override with `MCP_HOST`, `MCP_PORT`, and `MCP_PATH`.

## Useful Tools

- `mcplab_generate_scenario_entry`
- `mcplab_validate_config`
- `mcplab_list_library`
- `mcplab_get_library_item`
- `mcplab_run_eval`
- `mcplab_read_run_artifact`
