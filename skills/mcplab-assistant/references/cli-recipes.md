# CLI Recipes

Use these commands for MCPLab operator tasks.
Source of truth: `packages/cli/src/cli.ts`.

## Command Selection Matrix

- Run evaluations once: `mcplab run`
- Start local app/API bridge: `mcplab app`
- Rebuild report from prior run: `mcplab report`
- Query run artifacts for LLM/automation: `mcplab results`

## Run Evaluations

```bash
# Run all scenarios from a config
mcplab run -c mcplab/evals/eval.yaml

# Run one scenario
mcplab run -c mcplab/evals/eval.yaml -s basic-check

# Run variance testing
mcplab run -c mcplab/evals/eval.yaml -n 5

# Run each scenario with selected agents
mcplab run -c mcplab/evals/eval.yaml --agents claude-haiku,gpt-4o-mini

# Run each scenario with all available agents
mcplab run -c mcplab/evals/eval.yaml --agents-all

# Pick config and scenarios interactively at the terminal
mcplab run --interactive
```

Notes:
- `-c/--config` is required unless using `--interactive`. Interactive mode prompts you to select a config file and scenarios without specifying flags.
- `--agents` values must match agent IDs loaded from config/library.
- `--runs`/`-n` must be a positive number.

## Batch Runs (Directory Config)

Passing a directory to `-c/--config` runs all `.yaml`/`.yml` files found recursively in that folder.

```bash
# Run every config file under mcplab/evals/
mcplab run -c mcplab/evals/

# Stop after the first config that produces a failure
mcplab run -c mcplab/evals/ --bail
```

Notes:
- Each config file is executed as a separate run.
- `--bail` stops the batch as soon as any config run fails. Useful in CI to surface the first breakage quickly.

## Serve App

```bash
mcplab app --evals-dir mcplab/evals --runs-dir mcplab/results/evaluation-runs --port 8787 --open
mcplab app --host 0.0.0.0 --port 8787
mcplab app --interactive
```

Notes:
- `--port` must be a positive number.
- `--interactive` prompts for host, port, and directory paths before startup — use when you don't want to pass all flags on the command line.
- `--dev` proxies frontend requests to Vite while keeping API local.
- `--libraries-dir` points to bundle root for reusable servers/agents/test-cases.

## Regenerate Report

```bash
# From explicit run directory
mcplab report --input mcplab/results/evaluation-runs/<run-id>

# Interactive run directory picker
mcplab report --interactive --runs-dir mcplab/results/evaluation-runs
```

This reads `results.json` in the run directory and writes a fresh `report.html`.

## Query Results (LLM-First)

```bash
# List known runs
mcplab results list

# Show run payload
mcplab results show --run <run-id> --format json

# Search compact structured hits (auto refreshes index if run files changed)
mcplab results search "tool failed timeout" --status failed --limit 10 --format json

# Fetch focused context only
mcplab results context --run <run-id> --scenario <scenario-id> --around 42 --format markdown

# Optional manual rebuild
mcplab results index --rebuild
```

Notes:
- `mcplab results search` calls index load/build automatically; explicit `results index` is optional.
- Search defaults: `--status all --source results,trace,summary --limit 10 --format json`.
- Use `--source` and `--scenario` filters to keep context small.
