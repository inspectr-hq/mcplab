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

## Minimal Manual-Test MCP Servers (Dev Only)

These tiny servers are useful for manual testing in MCP Lab (connectivity, auth, OAuth Debugger).
They live outside the published package code in:

- `/Users/tim.haselaars/Sites/mcp-evaluation/dev/mcp-test-servers`

### 1) Public (no auth)

```bash
npm run mcp:test:public
```

Defaults:
- Base URL: `http://127.0.0.1:3111`
- MCP endpoint: `/mcp`

### 2) Bearer-protected

```bash
MCP_TEST_BEARER_TOKEN=demo-bearer-token npm run mcp:test:bearer
```

Defaults:
- Base URL: `http://127.0.0.1:3112`
- MCP endpoint: `/mcp`
- Protected probe endpoint: `/probe`

### 3) OAuth mock (for OAuth Debugger)

```bash
npm run mcp:test:oauth-mock
```

Defaults:
- Base URL: `http://127.0.0.1:3113`
- MCP endpoint: `/mcp` (bearer-protected after token exchange)
- OAuth endpoints:
  - `/.well-known/oauth-protected-resource`
  - `/.well-known/oauth-authorization-server`
  - `/authorize`
  - `/token`
  - `/register` (DCR)
  - `/client-metadata.json` (CIMD)
  - `/probe` (protected resource probe)

Default pre-registered client:
- `client_id`: `mcplab-debugger`
- `client_secret`: `mcplab-debugger-secret`
- `redirect_url`: `http://localhost:6274/oauth/`
- `scope`: `openid profile mcp`

## Useful Tools

- `mcplab_generate_scenario_entry`
- `mcplab_validate_config`
- `mcplab_list_library`
- `mcplab_get_library_item`
- `mcplab_run_eval`
- `mcplab_read_run_artifact`
