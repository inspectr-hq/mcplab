# Examples Map

Map user goals to reliable starting points.

## Goal -> Starting Point

- "I need a baseline config to start from."
  Use skill `mcplab-test-case-authoring` for config authoring guidance.

- "I need OAuth auth."
  Use skill `mcplab-test-case-authoring` for auth config guidance.

- "I need to compare models."
  Start with one scenario and run `mcplab run -c <config> --agents <id1,id2>`.

- "I need to debug failing runs."
  Follow `references/troubleshooting.md` and inspect `results.json` then `trace.jsonl`.

- "I need to run all my configs at once."
  Use `mcplab run -c <directory>/` to run all `.yaml`/`.yml` files recursively. Add `--bail` to stop on first failure. See `references/cli-recipes.md` Batch Runs section.

- "I need examples for assertions."
  Use skill `mcplab-test-case-authoring` for copy-ready snippets covering tool constraints, tool sequences, and all response assertion types (`eval` section).

## Selection Heuristic

1. Start from the smallest valid config.
2. Run it unchanged once to establish a baseline.
3. Add one change at a time (agent, scenario, or auth).
4. Re-run and validate before adding the next change.
