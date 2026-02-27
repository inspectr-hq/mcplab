# Config Recipes

Use this as a schema-first guide for MCPLab config authoring.
Source of truth: `config-schema.json`.

## Schema Contract (Required, Enums, Constraints)

### Root Object

- Required keys: `servers`, `agents`, `scenarios`

### `servers`

- Type: object map (`server_name -> server_config`)
- Per server required keys: `transport`, `url`
- `transport`:
  - Type: string
  - Allowed values: `http` only
- `url`:
  - Type: string
  - Must be valid URI
- `auth` (optional):
  - `oneOf` two valid shapes:
    1. Bearer:
      - Required: `type`, `env`
      - `type` must be `bearer`
    2. OAuth client credentials:
      - Required: `type`, `token_url`, `client_id_env`, `client_secret_env`
      - `type` must be `oauth_client_credentials`
      - Optional: `scope`, `audience`, `token_params` (`string -> string` map)

### `agents`

- Type: object map (`agent_name -> agent_config`)
- Per agent required keys: `provider`, `model`
- `provider` enum: `openai`, `anthropic`, `azure_openai`
- `model`: string
- `temperature` (optional): number from `0` to `2`
- `max_tokens` (optional): integer from `1` to `100000`
- `system` (optional): string

### `scenarios`

- Type: array
- Minimum items: `1`
- Per scenario required keys: `id`, `agent`, `servers`, `prompt`
- `id`:
  - Type: string
  - Regex: `^[a-z0-9-]+$` (kebab-case)
- `agent`: string (must reference key under `agents`)
- `servers`:
  - Type: array of strings
  - Minimum items: `1`
  - Each value must reference key under `servers`
- `prompt`: string
- `eval` (optional):
  - `tool_constraints.required_tools`: string[]
  - `tool_constraints.forbidden_tools`: string[]
  - `tool_sequence.allow`: string[][]
  - `response_assertions`: array of either:
    - regex assertion: `{ type: "regex", pattern: string }`
    - jsonpath assertion: `{ type: "jsonpath", path: string, equals?: string|number|boolean }`
- `extract` (optional):
  - Array of objects with required `name`, `from`, `regex`
  - `from` enum: `final_text` only
  - `regex` should include named capture group `value`

## Minimal Valid Config

```yaml
servers:
  demo-server:
    transport: "http"
    url: "http://localhost:3000/mcp"

agents:
  claude-haiku:
    provider: "anthropic"
    model: "claude-3-5-haiku-20241022"
    temperature: 0
    max_tokens: 2048

scenarios:
  - id: "basic-check"
    agent: "claude-haiku"
    servers: ["demo-server"]
    prompt: "Use available tools to complete the task."
```

## Full Annotated Template

```yaml
servers:
  my-server:
    transport: "http" # enum: http
    url: "https://api.example.com/mcp" # URI required
    auth: # optional
      type: "oauth_client_credentials" # or "bearer"
      token_url: "https://auth.example.com/oauth/token"
      client_id_env: "MCP_CLIENT_ID"
      client_secret_env: "MCP_CLIENT_SECRET"
      scope: "mcp.read" # optional
      audience: "https://api.example.com" # optional
      token_params: # optional map<string,string>
        resource: "mcplab"

agents:
  claude:
    provider: "anthropic" # enum: openai|anthropic|azure_openai
    model: "claude-3-5-sonnet-20241022"
    temperature: 0 # 0..2
    max_tokens: 4096 # 1..100000
    system: "You are a careful assistant." # optional

scenarios:
  - id: "search-and-summarize" # regex: ^[a-z0-9-]+$
    agent: "claude" # must exist in agents
    servers: ["my-server"] # each must exist in servers
    prompt: "Find matching items and summarize key outcomes."
    eval:
      tool_constraints:
        required_tools: ["search_items"]
        forbidden_tools: ["delete_item"]
      tool_sequence:
        allow:
          - ["search_items", "summarize_items"]
      response_assertions:
        - type: "regex"
          pattern: "Found [0-9]+ items"
        - type: "jsonpath"
          path: "$.summary.count"
          equals: 10
    extract:
      - name: "item_count"
        from: "final_text" # enum: final_text
        regex: "Found (?<value>[0-9]+) items"
```

## Auth Patterns

### Bearer Token

```yaml
servers:
  my-server:
    transport: "http"
    url: "https://api.example.com/mcp"
    auth:
      type: "bearer"
      env: "MCP_TOKEN"
```

### OAuth Client Credentials

```yaml
servers:
  my-server:
    transport: "http"
    url: "https://api.example.com/mcp"
    auth:
      type: "oauth_client_credentials"
      token_url: "https://auth.example.com/oauth/token"
      client_id_env: "MCP_CLIENT_ID"
      client_secret_env: "MCP_CLIENT_SECRET"
      scope: "mcp.read"
      audience: "https://api.example.com"
```

## Schema-Driven Authoring Order

1. Add root keys: `servers`, `agents`, `scenarios`.
2. Define one valid server (`transport`, `url`).
3. Define one valid agent (`provider`, `model`).
4. Define one valid scenario (`id`, `agent`, `servers`, `prompt`).
5. Run once with `mcplab run -c ...`.
6. Add optional `eval` and `extract`.
7. Add more servers/agents/scenarios only after baseline passes.

## Cross-Reference Checklist

1. Every `scenarios[*].agent` exists under `agents`.
2. Every `scenarios[*].servers[*]` exists under `servers`.
3. Every scenario `id` is kebab-case and unique.
4. `auth` object matches exactly one allowed shape.
5. `temperature` and `max_tokens` values stay within schema bounds.
6. `extract[*].from` is `final_text`.

## Preflight Env Checklist

1. Agent provider credentials:
   - `anthropic` -> `ANTHROPIC_API_KEY`
   - `openai` -> `OPENAI_API_KEY`
   - `azure_openai` -> `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`
2. Server auth credentials:
   - `bearer` -> env var named by `auth.env`
   - `oauth_client_credentials` -> env vars named by `client_id_env` and `client_secret_env`
3. Endpoint sanity:
   - `servers.<name>.url` is reachable and points to MCP HTTP endpoint
   - `auth.token_url` is reachable for OAuth flows
