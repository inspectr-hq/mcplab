# Release Guide

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing in an npm workspaces monorepo.

## Publishable Packages

| Package                       | Path                  |
|-------------------------------|-----------------------|
| `@inspectr/mcplab-core`       | `packages/core`       |
| `@inspectr/mcplab` (CLI)      | `packages/cli`        |
| `@inspectr/mcplab-mcp-server` | `packages/mcp-server` |
| `@inspectr/mcplab-reporting`  | `packages/reporting`  |

Private packages (`@inspectr/mcplab-app`, `@inspectr/mcplab-website`) are ignored by changesets.

## Release Steps

### 1. Add a changeset

After making changes, create a changeset describing what changed:

```bash
npm run changeset
```

This will prompt you to:
- Select which packages are affected
- Choose the semver bump type (patch / minor / major)
- Write a summary of the changes

A markdown file is created in `.changeset/`. Commit it with your changes.

### 2. Version packages

When ready to release, apply all pending changesets to bump versions and update changelogs:

```bash
npm run version
```

This updates `package.json` versions and `CHANGELOG.md` files, then removes the consumed changeset files. Review and commit the result.

### 3. Verify

Before publishing, make sure everything passes:

```bash
npm run test
npm run build
npm run validate:configs
```

### 4. Publish

```bash
npm run release
```

This runs `npm run build` followed by `changeset publish`, which publishes all packages with updated versions to npm.

### Publish individual packages (alternative)

```bash
npm run publish:core
npm run publish:reporting
npm run publish:mcp-server
npm run publish:cli
npm run publish:all        # all four at once
```

### CLI package preparation

If releasing the CLI with bundled web app assets:

```bash
npm run release:prepare:cli
```

This builds the app and copies its dist into `packages/cli/dist/app` before publishing.

## CI/CD Workflows

### `publish-workspace-package.yml` (manual)

Releases a single workspace package via GitHub Actions. Inputs:
- `package_name` — e.g. `@inspectr/mcplab-core`
- `version` — `patch`, `minor`, `major`, or explicit version
- `publish_to_npm` — whether to publish
- `notify_dependents` — trigger dependent package bump PRs

### `bump-dependent-packages.yml` (automatic)

Fires after a package is released and creates a PR to bump dependents.

### Required secrets

- `GH_PAT` — GitHub Personal Access Token (push, tag, dispatch)
- `NPM_TOKEN` — npm authentication token

## Quick Reference

```bash
# 1. Create changeset
npm run changeset

# 2. Commit the changeset file with your changes
git add .changeset/ && git commit -m "add changeset"

# 3. When ready to release: version
npm run version
git add -A && git commit -m "release X.Y.Z"

# 4. Verify
npm run test
npm run build
npm run validate:configs

# 5. Publish
npm run release
git push && git push --tags
```
