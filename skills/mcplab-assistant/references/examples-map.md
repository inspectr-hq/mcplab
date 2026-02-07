# Examples Map

Map user goals to existing example configs in `examples/`.

## Goal -> Example

- "I need a baseline config to start from."
  Use `examples/eval.yaml`.

- "I need TrendMiner-focused scenarios."
  Use `examples/eval-trendminer.yaml`.

- "I need a broad TrendMiner regression suite."
  Use `examples/eval-trendminer-comprehensive.yaml`.

- "I need a small TrendMiner suite for quick checks."
  Use `examples/eval-trendminer-simple.yaml`.

- "I need multi-LLM comparison config."
  Use `examples/eval-trendminer-multi-llm.yaml`.

- "I need TM MCP server-specific setup."
  Use `examples/eval-tm-mcp-server.yaml`.

## Selection Heuristic

1. Pick the smallest example that satisfies the requested domain.
2. Run it unchanged once.
3. Clone and adjust only the sections needed:
- `servers` for endpoint/auth
- `agents` for model/provider
- `scenarios` for prompts/assertions

