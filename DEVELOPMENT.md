# Development Guide

## Prerequisites

- Node.js (see `.nvmrc` or `engines` field in `package.json`)
- npm

## Setup

```bash
npm install
```

## Running in Development

### Full App (recommended)

Run these two commands in separate terminals:

```bash
# Terminal 1 — CLI + backend (builds core, serves app)
npm run app:dev

# Terminal 2 — UI hot-reload (Vite dev server)
npm run app:dev:ui
```

### CLI only

```bash
npm run dev
```

### MCP Server

```bash
npm run mcp:dev
```

### Website

```bash
npm run website:dev
```

## Building

```bash
npm run build
```

## Testing

```bash
npm test
```

Global Copilot development uses the same app server and port as the rest of the UI. Its CopilotKit endpoint is `/api/copilotkit`, thread APIs live under `/api/global-copilot/threads`, and its workspace-local LibSQL database is `mcplab/.mastra/global-copilot.db`. Removing that database starts memory from scratch; existing browser IndexedDB conversations are intentionally not migrated or read.

When changing Global Copilot, run both workspace suites because the runtime is in `packages/cli` and the custom headless UI is in `packages/app`:

```bash
npm run test -w @inspectr/mcplab
npm run test -w @inspectr/mcplab-app
```

## Package Structure

| Package               | Description         |
|-----------------------|---------------------|
| `packages/cli`        | CLI entrypoint      |
| `packages/app`        | React UI            |
| `packages/core`       | Shared core logic   |
| `packages/mcp-server` | MCP server          |
| `packages/reporting`  | Reporting utilities |
| `packages/website`    | Marketing/docs site |
