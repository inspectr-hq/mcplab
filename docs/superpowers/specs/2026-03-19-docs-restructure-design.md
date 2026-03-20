# MCPLab Documentation Restructure — Design Spec

## Goal

Restructure the MCPLab public website documentation from 6 loosely organized pages into a 15-page two-track structure that serves both new users discovering the tool and power users returning for reference. CLI and App UI are treated as equal first-class paths.

## Audience

**New users** — developers who have not used MCPLab before. Need a clear path from installation to first eval result without friction.

**Power users** — developers already running evals who want concise reference material for specific features (config schema, reports, CI/CD, compare, library).

## What Changes

### Removed from docs
- `mcplab watch` — referenced in existing docs but not implemented in the CLI; remove all mentions
- OAuth debugger — internal tooling, not for public docs
- `migrate-configs` command — internal migration utility, not for public docs
- Snapshot commands (`create`, `compare`, `drift detection`, `eval policy`) — not in public docs scope

### Kept and reorganized
All existing content from the 6 current pages is redistributed into the new structure. Nothing is thrown away — it moves into a more appropriate home.

### Added (currently undocumented features)
- `mcplab report` command
- `--interactive` flag on `mcplab run` — interactive scenario/run selection
- Compare agents (section within App / Reading Results, not a standalone page)
- Markdown reports (section within App / Reading Results, not a standalone page)
- Bearer token auth — direct value and env var reference
- Library management (App UI)
- Complete Configuration Schema reference page
- Environment Variables reference page

---

## Navigation Structure

```
Getting Started
  ├── Overview
  ├── Installation
  └── Quick Start

CLI
  ├── Running Evaluations
  ├── Configuration
  ├── Reports & Output
  └── CI/CD

App
  ├── Starting the App
  ├── Running Evaluations
  ├── Reading Results
  ├── AI Assistants
  ├── Tool Analysis
  └── Library

Reference
  ├── Configuration Schema
  └── Environment Variables
```

---

## Page Specifications

### Getting Started / Overview
**Purpose:** Explain what MCPLab is and when to use it. Give the reader enough context to decide whether to follow the CLI track or the App track.

**Content:**
- One-paragraph description of what MCPLab does
- The core workflow: write a config → run an eval → read results
- When to use CLI vs App (CLI for automation/CI, App for exploration and AI-assisted workflows)
- Link to Installation

**Source:** Current Overview page, lightly edited.

---

### Getting Started / Installation
**Purpose:** Get MCPLab installed and API keys configured.

**Content:**
- `npx @inspectr/mcplab --help` (zero-install usage)
- `npm install -g @inspectr/mcplab` (global install)
- Required `.env` setup: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AZURE_*` options
- Link to Environment Variables reference for full list

**Source:** Current Installation page.

---

### Getting Started / Quick Start
**Purpose:** Get a new user to their first passing eval in under 5 minutes. Works for both CLI and App users.

**Content:**
- Minimal `eval.yaml` example (one server, one agent, one scenario)
- `npx @inspectr/mcplab run -c eval.yaml`
- What output looks like (pass/fail in terminal, HTML report location)
- "Next: follow the CLI track or open the App"

**Source:** Current Quick Start page, trimmed to essentials.

---

### CLI / Running Evaluations
**Purpose:** Complete reference for the `mcplab run` command.

**Content:**
- Basic usage: `mcplab run -c eval.yaml`
- Filtering scenarios: `-s <scenario-id>`
- Selecting agents: `--agents <id,id>`, `--agents-all`
- Variance runs: `-n <count>`
- Annotating runs: `--run-note "text"`
- Custom output directory: `--runs-dir`
- Interactive mode: `--interactive` — prompts for scenario and run selection at the terminal
- Exit codes (0 = all pass, non-zero = failures — relevant for CI)

**Source:** Current Usage page (run section). Expands `--agents` and `--agents-all` options which are currently underdocumented.

---

### CLI / Configuration
**Purpose:** Full guide to writing an `eval.yaml` config file.

**Content:**
- Top-level structure: `servers`, `agents`, `scenarios`
- `servers` block: HTTP transport, `url`, bearer token auth (direct value `token: "abc"` and env var `token: $ENV_VAR`)
- `agents` block: `provider`, `model`, `temperature`; supported providers (anthropic, openai, azure)
- `scenarios` block: `id`, `agent`, `servers`, `prompt`, `eval` (tool_constraints, response_assertions)
- Assertion types: `required_tools`, `forbidden_tools`, regex assertions, contains assertions
- Reusable refs: `$ref` syntax for inline server/agent definitions within the same config file
- Library refs: referencing agents and servers defined in the library files (`$ref` to library items); links to App / Library for managing library content via the UI

**Source:** Current Configuration page, extended with bearer token auth and library refs.

---

### CLI / Reports & Output
**Purpose:** Explain what MCPLab writes after a run and how to work with it.

**Content:**
- Run directory structure: `results.json`, `trace.jsonl`, `report.html`, `summary.md`
- What each file contains (brief description)
- Opening the HTML report
- `mcplab report --input <runDir>` — regenerate report.html from an existing run directory
- `mcplab report --interactive` — pick a run from a list

**Source:** Partially in current Usage page. `mcplab report` command is currently undocumented.

---

### CLI / CI/CD
**Purpose:** Show how to run MCPLab headlessly in automated pipelines.

**Content:**
- GitHub Actions workflow example (full YAML)
- Required environment variables in CI
- Exit code behaviour (non-zero on any failing scenario)
- Run directory persistence as CI artifact
- `--run-note` for labelling CI runs

**Source:** Existing `docs/github-actions.md`, adapted for the website.

---

### App / Starting the App
**Purpose:** Get the App running and orient the user to the UI.

**Content:**
- `mcplab app` command
- Key options: `--port`, `--open`, `--evals-dir`, `--runs-dir`, `--libraries-dir`
- Default directory behaviour when flags are omitted (current working directory for evals, `~/.mcplab/runs` for runs)
- What opens in the browser (dashboard overview)
- Brief tour of the sidebar navigation

**Source:** Current App Mode page (intro section).

---

### App / Running Evaluations
**Purpose:** Run an eval from the App UI.

**Content:**
- Opening the Run Evaluation page
- Selecting a config
- Choosing agents (inline agents + library agents)
- Setting variance run count
- Launching and watching live progress

**Source:** Currently undocumented in website docs.

---

### App / Reading Results
**Purpose:** Understand a completed run's output via the UI.

**Content:**
- The Results list (recent runs, pass rates at a glance)
- Result Detail: per-scenario breakdown, tool usage, pass/fail per assertion, trace inspection
- Markdown Reports: browsing custom markdown report files
- Compare: selecting multiple agents from the same run, reading the comparison view

**Source:** Currently undocumented. Compare page entirely new to docs.

---

### App / AI Assistants
**Purpose:** Explain the two built-in AI chat tools.

**Content:**
- **Scenario Assistant:** describe a test goal in plain language, get an `eval.yaml` scenario back; iterative refinement workflow
- **Result Assistant:** ask questions about a completed run; example prompts (explain failures, spot patterns, suggest improvements)

**Source:** Current App Mode page (AI tools section), expanded with workflow detail.

---

### App / Tool Analysis
**Purpose:** Explain how to review MCP tool definitions for quality.

**Content:**
- What tool analysis checks (description quality, parameter clarity, LLM-friendliness, safety)
- Running an analysis from the App
- Reading the severity breakdown (critical / warning / info)
- Understanding individual recommendations
- Browsing persisted analysis reports

**Source:** Current App Mode page (Tool Analysis section), expanded.

---

### App / Library
**Purpose:** Explain the reusable library system for agents, servers, and scenarios.

**Content:**
- What the library is: shared `agents.yaml` and `servers.yaml` files loaded at startup via `--libraries-dir`
- How library agents and servers appear in the App (available in Run Evaluation agent picker)
- Managing library files via the App UI
- Note: the `$ref` YAML syntax for referencing library items in eval configs is documented in CLI / Configuration; this page covers UI-based management only

**Source:** Currently undocumented.

---

### Reference / Configuration Schema
**Purpose:** Complete field-level reference for `eval.yaml`. The page power users bookmark.

**Content:**
- Full schema table: field name, type, required/optional, description, example
- Covers: `servers.*` (including `transport`, `url`, `token` for bearer auth — direct value and env var), `agents.*` (provider, model, temperature), `scenarios.*`, all assertion types (`required_tools`, `forbidden_tools`, regex, contains)
- Cross-links to the Configuration guide for narrative context

**Source:** Synthesized from CLI source and existing Configuration page.

---

### Reference / Environment Variables
**Purpose:** All env vars in one place.

**Content:**
- Table: variable name, purpose, used by (CLI / App / both)
- Provider keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`
- Server auth: custom bearer token env vars referenced in configs
- Any CLI behaviour flags set via env

**Source:** Distributed across README and current Installation page; consolidated here.

---

## Implementation Notes

### Website tech stack
Pages are written in Astro SSG with a `docs.ts` data file that drives sidebar navigation. Adding a page requires: (1) a new entry in `docs.ts`, (2) a new `.astro` or `.mdx` file under `src/pages/docs/`.

### README deduplication
`packages/cli/README.md` is currently identical to the root `README.md` (830 lines). After the website docs are updated, `packages/cli/README.md` should be trimmed to a short npm-focused summary with a link to the website docs. This is out of scope for this restructure but should follow as a cleanup task.

### URL slugs

| Page | Slug |
|------|------|
| Getting Started / Overview | `/docs` |
| Getting Started / Installation | `/docs/installation` *(unchanged)* |
| Getting Started / Quick Start | `/docs/quick-start` *(unchanged)* |
| CLI / Running Evaluations | `/docs/cli/running-evaluations` |
| CLI / Configuration | `/docs/cli/configuration` |
| CLI / Reports & Output | `/docs/cli/reports-output` |
| CLI / CI/CD | `/docs/cli/ci-cd` |
| App / Starting the App | `/docs/app/getting-started` |
| App / Running Evaluations | `/docs/app/running-evaluations` |
| App / Reading Results | `/docs/app/reading-results` |
| App / AI Assistants | `/docs/app/ai-assistants` |
| App / Tool Analysis | `/docs/app/tool-analysis` |
| App / Library | `/docs/app/library` |
| Reference / Configuration Schema | `/docs/reference/configuration` |
| Reference / Environment Variables | `/docs/reference/environment-variables` |

**Redirects required** for old URLs that are moving:

| Old URL | Redirects to |
|---------|-------------|
| `/docs/configuration` | `/docs/cli/configuration` |
| `/docs/usage` | `/docs/cli/running-evaluations` |
| `/docs/app-mode` | `/docs/app/getting-started` |
