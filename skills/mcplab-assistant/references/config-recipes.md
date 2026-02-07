# Config Recipes

Use these patterns for MCPLab evaluation configs.
Source of truth: `config-schema.json`.

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

## Server Auth Patterns

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

## Agent Patterns

```yaml
agents:
  claude:
    provider: "anthropic"
    model: "claude-3-5-sonnet-20241022"
    temperature: 0
  gpt-mini:
    provider: "openai"
    model: "gpt-4o-mini"
    temperature: 0
  azure-gpt:
    provider: "azure_openai"
    model: "gpt-4o"
    temperature: 0
```

## Scenario Pattern With Evaluation

```yaml
scenarios:
  - id: "search-and-summarize"
    agent: "claude"
    servers: ["my-server"]
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
    extract:
      - name: "item_count"
        from: "final_text"
        regex: "Found (?<value>[0-9]+) items"
```

## Validation Checklist

1. `servers`, `agents`, and `scenarios` exist.
2. Every scenario `agent` key exists in `agents`.
3. Every scenario server entry exists in `servers`.
4. Scenario `id` values are unique kebab-case.
5. Auth env var names are set in runtime environment.

