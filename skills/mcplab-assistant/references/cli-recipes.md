# CLI Recipes

Use these commands for MCPLab operator tasks.
Source of truth: `packages/cli/src/cli.ts`.

## Command Selection Matrix

- Run evaluations once: `mcplab run`
- Auto-rerun on config change: `mcplab watch`
- Start local app/API bridge: `mcplab app`
- Rebuild report from prior run: `mcplab report`

## Run Evaluations

```bash
# Run all scenarios
mcplab run -c configs/eval.yaml

# Run one scenario
mcplab run -c configs/eval.yaml -s basic-check

# Run variance testing
mcplab run -c configs/eval.yaml -n 5

# Run each scenario with multiple agents
mcplab run -c configs/eval.yaml --agents claude-haiku,gpt-4o-mini
```

Notes:
- `--runs`/`-n` must be a positive number.
- `--agents` values must match keys under `agents:` in config.

## Watch Config And Rerun

```bash
mcplab watch -c configs/eval.yaml
mcplab watch -c configs/eval.yaml -s basic-check -n 3 --debounce 750
```

Notes:
- `watch` supports `--config`, `--scenario`, `--runs`, `--debounce`.
- `watch` does not support `--agents`.

## Serve App

```bash
mcplab app --configs-dir configs --runs-dir runs --port 8787 --open
mcplab app --host 0.0.0.0 --port 8787
mcplab app --dev
```

Notes:
- `--port` must be a positive number.
- `--dev` proxies frontend requests to Vite, API remains local.

## Regenerate Report

```bash
mcplab report --input runs/20260206-212239
```

This reads `results.json` in the run dir and writes a new `report.html`.

