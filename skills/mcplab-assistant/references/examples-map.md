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

- "I need examples for assertions."
  Use `references/config-recipes.md` section `eval` and provide copy-ready snippets for tool constraints, tool sequences, and all response assertion types.

## Selection Heuristic

1. Start from the smallest valid config.
2. Run it unchanged once to establish a baseline.
3. Add one change at a time (agent, scenario, or auth).
4. Re-run and validate before adding the next change.
