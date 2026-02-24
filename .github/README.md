# GitHub Automation (Monorepo Releases)

This repo includes GitHub Actions to publish individual workspace packages and automatically open PRs that bump dependent workspace packages.

## Workflows

### `publish-workspace-package.yml`

Manual workflow for releasing a single workspace package.

Inputs:
- `package_name`: Workspace package name (for example `@inspectr/mcplab-core`)
- `version`: Semver bump (`patch`, `minor`, `major`, etc.) or explicit version (`0.1.2`)
- `publish_to_npm`: Whether to publish to npm
- `notify_dependents`: Whether to dispatch an event that triggers dependent bump PRs

What it does:
- Resolves the selected package under `packages/*`
- Bumps that package version
- Updates the root `package-lock.json`
- Builds the package
- Optionally publishes to npm
- Commits the version bump and creates a tag (`<package>@v<version>`)
- Dispatches `workspace-package-released` back to this repo

### `bump-dependent-packages.yml`

Creates a PR when a workspace dependency is released.

Triggers:
- `repository_dispatch` with event type `workspace-package-released`
- `release.published` (when tag format is `<package>@v<version>`)
- Manual `workflow_dispatch` (useful for testing)

What it does:
- Detects the released package and version
- Scans root and `packages/*/package.json`
- Updates dependency ranges to `^<released-version>`
- Updates lockfiles (`package-lock.json` where present)
- Opens a PR with the dependency bumps

## Required Secrets

- `GH_PAT`
  - Used for pushing release commits/tags and sending repository dispatch events
  - Also allows downstream workflows to trigger (unlike default `GITHUB_TOKEN` in some cases)
- `NPM_TOKEN`
  - Required only when `publish_to_npm=true`

## Typical Usage

1. Run `Publish Workspace Package`
2. Choose a package like `@inspectr/mcplab-core`
3. Set `version` to `patch` (or explicit version)
4. Set `publish_to_npm` to `true` or `false`
5. Keep `notify_dependents=true` to auto-open a bump PR

## Notes

- Private workspace packages are blocked from publish in the release workflow.
- The bump PR workflow only updates packages that already depend on the released package.
