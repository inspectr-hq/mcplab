# Examples Map

Map user goals to reliable starting points.

## Goal -> Starting Point

- "I need a baseline config to start from."
  Use the minimal template from `references/config-recipes.md` and tailor IDs/URLs.

- "I need OAuth auth."
  Use the OAuth client credentials snippet in `references/config-recipes.md`.

- "I need to compare models."
  Start with one scenario and run `mcplab run -c <config> --agents <id1,id2>`.

- "I need to debug failing runs."
  Follow `references/troubleshooting.md` and inspect `results.json` then `trace.jsonl`.

- "I need to run all my configs at once."
  Use `mcplab run -c <directory>/` to run all `.yaml`/`.yml` files recursively. Add `--bail` to stop on first failure. See `references/cli-recipes.md` Batch Runs section.

- "I need examples for assertions."
  Use `references/config-recipes.md` section `eval` and provide copy-ready snippets for tool constraints, tool sequences, tool-input contains/regex/JSONPath assertions, response assertions, and Judge checks with optional context.

- "I need to verify how an MCP tool was called."
  Prefer `tool_input_contains`, `tool_input_regex`, or `tool_input_jsonpath` for deterministic requirements. Use `agent_check` with `agent_context.include_tool_inputs: true` when interpreting the arguments is semantic.

## Selection Heuristic

1. Start from the smallest valid config.
2. Run it unchanged once to establish a baseline.
3. Add one change at a time (agent, scenario, or auth).
4. Re-run and validate before adding the next change.
