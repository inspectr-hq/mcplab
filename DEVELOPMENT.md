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

## Package Structure

| Package               | Description         |
|-----------------------|---------------------|
| `packages/cli`        | CLI entrypoint      |
| `packages/app`        | React UI            |
| `packages/core`       | Shared core logic   |
| `packages/mcp-server` | MCP server          |
| `packages/reporting`  | Reporting utilities |
| `packages/website`    | Marketing/docs site |
