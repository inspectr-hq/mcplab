# Config Recipes

Use this as a schema-first guide for MCPLab config authoring.
Source of truth: `config-schema.json`.

## Schema Contract (Required, Enums, Constraints)

### Root Object

- Required keys: `agents`, `scenarios`
- Optional keys: `name`, `servers` (deprecated pool), `snapshot_eval`

### `agents`

- Type: array
- Item shape:
  - library ref: `{ ref: "<agent-id>" }`
  - inline config: `{ id, provider, model, ... }`
- Inline required keys: `id`, `provider`, `model`
- `provider` enum: `openai`, `anthropic`, `azure_openai`
- Optional fields:
  - `temperature`: number `0..2`
  - `max_tokens`: integer `1..200000`
  - `system`: string

### `scenarios`

- Type: array
- Minimum items: `1`
- Item shape:
  - library ref: `{ ref: "<scenario-id>" }`
  - inline config
- Inline required keys: `id`, `servers`, `prompt`
- Optional: `agent`, `mcp_servers`, `eval`, `extract`, `snapshot_eval`
- `id` best practice: kebab-case and unique.
- `servers`: string array of server labels the scenario can use.
- `mcp_servers`: optional array of MCP server entries:
  - ref item: `{ ref: "<server-id>" }`
  - inline item: `{ id, transport, url, auth? }`

### Server Auth (`mcp_servers[].auth` or deprecated top-level `servers[].auth`)

- Bearer:
  - Required: `type: bearer`, `env`
- OAuth client credentials:
  - Required: `type: oauth_client_credentials`, `token_url`, `client_id_env`, `client_secret_env`
  - Optional: `scope`, `audience`, `token_params`
- OAuth authorization code:
  - Required: `type: oauth_authorization_code`, `client_id`, `redirect_url`
  - Optional: `client_secret`, `scope`

### `eval`

- `tool_constraints.required_tools`: string[]
- `tool_constraints.forbidden_tools`: string[]
- `tool_sequence.allow`: string[][]
- `response_assertions`:
  - regex assertion: `{ type: "regex", pattern: string }`
  - jsonpath assertion: `{ type: "jsonpath", path: string, equals?: string|number|boolean }`

### `extract`

- Type: array
- Required per item: `name`, `from`, `regex`
- `from` enum: `final_text`
- Include a named capture group `(?<value>...)` in regex.

## Minimal Valid Config

```yaml
agents:
  - id: claude-haiku
    provider: anthropic
    model: claude-3-5-haiku-20241022
    temperature: 0

scenarios:
  - id: basic-check
    agent: claude-haiku
    servers: [demo-server]
    mcp_servers:
      - id: demo-server
        transport: http
        url: http://localhost:3000/mcp
    prompt: Use available tools to complete the task.
```

## Full Annotated Template

```yaml
name: OAuth eval sample

agents:
  - ref: claude-haiku
  - id: gpt-4o-mini
    provider: openai
    model: gpt-4o-mini
    temperature: 0

scenarios:
  - id: search-and-summarize
    agent: gpt-4o-mini
    servers: [orders-api]
    mcp_servers:
      - ref: orders-api
    prompt: Find matching items and summarize key outcomes.
    eval:
      tool_constraints:
        required_tools: [search_items]
        forbidden_tools: [delete_item]
      tool_sequence:
        allow:
          - [search_items, summarize_items]
      response_assertions:
        - type: regex
          pattern: Found [0-9]+ items
        - type: jsonpath
          path: $.summary.count
          equals: 10
    extract:
      - name: item_count
        from: final_text
        regex: 'Found (?<value>[0-9]+) items'
```

## Auth Pattern Examples

### Bearer

```yaml
mcp_servers:
  - id: my-server
    transport: http
    url: https://api.example.com/mcp
    auth:
      type: bearer
      env: MY_SERVER_TOKEN
```

### OAuth Client Credentials

```yaml
mcp_servers:
  - id: my-server
    transport: http
    url: https://api.example.com/mcp
    auth:
      type: oauth_client_credentials
      token_url: https://auth.example.com/oauth/token
      client_id_env: MCP_CLIENT_ID
      client_secret_env: MCP_CLIENT_SECRET
      scope: mcp.read
```

### OAuth Authorization Code

```yaml
mcp_servers:
  - id: my-server
    transport: http
    url: https://api.example.com/mcp
    auth:
      type: oauth_authorization_code
      client_id: my-client-id
      redirect_url: http://127.0.0.1:8787/api/oauth-debugger/sessions/<session-id>/callback
      scope: openid profile
```

## Schema-Driven Authoring Order

1. Add one working `agents` entry.
2. Add one working `scenarios` entry with `servers`, `mcp_servers`, and `prompt`.
3. Run once with `mcplab run -c ...`.
4. Add optional `eval` and `extract` once baseline passes.
5. Add more agents/scenarios incrementally.

## Cross-Reference Checklist

1. Every inline `scenario.agent` exists in loaded agents (config and library).
2. Every scenario has at least one `servers` label and one reachable MCP server path.
3. Every scenario `id` is unique.
4. `auth` matches exactly one schema shape.
5. Numeric fields remain within schema bounds.
6. `extract[*].from` is `final_text`.

## Preflight Env Checklist

1. Provider credentials:
   - `anthropic` -> `ANTHROPIC_API_KEY`
   - `openai` -> `OPENAI_API_KEY`
   - `azure_openai` -> `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`
2. Server auth credentials:
   - `bearer` -> variable named by `auth.env`
   - `oauth_client_credentials` -> vars named by `client_id_env` and `client_secret_env`
3. Endpoint sanity:
   - `mcp_servers[].url` is reachable and points to MCP HTTP endpoint
   - `auth.token_url` is reachable for OAuth flows
