# @inspectr/mcplab

## 1.17.0

### Minor Changes

- feat: Provide list endpoints
- feat: Show pass rate of last run
- feat: Rerun past runs
- chore: Store tool_tokens_total in results metadata

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.13.0
  - @inspectr/mcplab-mcp-server@1.4.1
  - @inspectr/mcplab-reporting@1.1.14

## 1.16.0

### Minor Changes

- feat: Override MCP server at runtime
- feat: Copy & Download MCP info
- feat: Add copy option on the tool list
- feat: Filter Compare list by date
- feat: Group Compare list by day
- feat: structured check suggestions and safe request abort handling
- chore: Add filter by "Last 14 days"
- chore: Show path in compare mode
- chore: Improve skill & MCP tool descriptions
- refactor: Remove snapshot logic
- refactor: Remove auto-check logic

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.12.0
  - @inspectr/mcplab-mcp-server@1.4.0
  - @inspectr/mcplab-reporting@1.1.13

## 1.15.0

### Minor Changes

- feat: Dashboard shows only data for past 30 days
- feat: Dashboard calculate WoW deltas
- fix: Preserve nested eval path when saving renamed config
- fix: Show paths for eval dropdown names

## 1.14.3

### Patch Changes

- feat: add date time filter for results
- feat: add day separator for results
- feat: Cancel running prompt
- fix: Align pass rate to the right

- Updated dependencies
  - @inspectr/mcplab-core@1.11.1
  - @inspectr/mcplab-mcp-server@1.3.2
  - @inspectr/mcplab-reporting@1.1.12

## 1.14.2

### Patch Changes

- fix: Keep YAML property hierarchy

## 1.14.1

### Patch Changes

- fix: Skip writing empty YAML configurations
- fix: Handle undefined intent values safely

## 1.14.0

### Minor Changes

- feat: Improve OAuth callback message
- fix: Extend debug info for OAuth Debug
- fix: Improve MCP title and annotation handling

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.11.0
  - @inspectr/mcplab-mcp-server@1.3.1
  - @inspectr/mcplab-reporting@1.1.11

## 1.13.0

### Minor Changes

- feat: Result CLI commands
- docs: Update docs
- mcp: Clean up tools and update MCP schemas

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-mcp-server@1.3.0
  - @inspectr/mcplab-core@1.10.0
  - @inspectr/mcplab-reporting@1.1.10

## 1.12.1

### Patch Changes

- feat: Show path and eval name in Queue and Results
- fix: Filter evals on levels

- Updated dependencies
  - @inspectr/mcplab-core@1.9.1
  - @inspectr/mcplab-mcp-server@1.2.3
  - @inspectr/mcplab-reporting@1.1.9

## 1.12.0

### Minor Changes

- feat: support referenced scenario overrides
- fix: add navigation for the eval configuration

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.9.0
  - @inspectr/mcplab-mcp-server@1.2.2
  - @inspectr/mcplab-reporting@1.1.8

## 1.11.0

### Minor Changes

- feat: OAuth-aware queue
- feat: Queue evaluation run
- feat: Navigate to eval results

## 1.10.0

### Minor Changes

- feat: include model name in run summaries
- feat: Stream assistant turn events
- feat: Show estimated tool token usage
- fix: Align date format elements
- fix: Show scenario name in compare

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.8.0
  - @inspectr/mcplab-mcp-server@1.2.1
  - @inspectr/mcplab-reporting@1.1.7

## 1.9.0

### Minor Changes

- feat: enhance handling of config paths and suite organization
- feat: add MCP server connection details
- feat: improve MCP tooling for the MCPLab
- feat: Add snippets for the result overview assistant
- feat: introduce cross-run Result Assistant for historical trend analysis
- feat: add MCP tools for run aggregation and regression comparison
- feat: enhance run comparison view with within-run mode and sticky headers
- feat: support batch config runs via directory path with --bail flag
- refactor: add log prefix for consistent CLI output in MCPLab app server

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.7.0
  - @inspectr/mcplab-mcp-server@1.2.0
  - @inspectr/mcplab-reporting@1.1.6

## 1.8.0

### Minor Changes

- feat: Extend response assertions
- feat: Oauth flow for scenario assistant session
- feat: Introduce OAuth session management
- feat: Show MCP server info on server detail page
- feat: Add prompt preview functionality for scenarios
- fix: Prevent reloading in the Library edit screens when Window focus changes
- fix: Improve OAuthDebugger sort OAuth servers alphabetically

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.6.0
  - @inspectr/mcplab-mcp-server@1.1.4
  - @inspectr/mcplab-reporting@1.1.5

## 1.7.0

### Minor Changes

- feat: OAuth Debuggerfeat: OAuth Debugger
- feat: Support OAuth login flow on run MCP evaluations
- feat: Support OAuth login flow on run MCP analysis
- feat: Run evaluations with --oauth-token <server=token>
- feat: improved OAuth setup UX (clearer flow controls, endpoint hints/tooltips, token auth method selection)

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.5.0
  - @inspectr/mcplab-mcp-server@1.1.3
  - @inspectr/mcplab-reporting@1.1.4

## 1.6.0

### Minor Changes

- feat: add analysis of title, outputSchema in tool analysis
  ux: Show tool annotations in tool analysis
  ux: Add "Run" button on Evalutations overview
  fix: Improved safety classification mechanism

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.4.0
  - @inspectr/mcplab-mcp-server@1.1.2
  - @inspectr/mcplab-reporting@1.1.3

## 1.5.1

### Patch Changes

- fix: use platform-specific path separator in ensureInsideRoot function (fixes #15)

## 1.5.0

### Minor Changes

- feat: add search capabilities and enhanced inputs across key page
- feat: enhance tool analysis report with severity and tool grouping, filters, and better UX controls

## 1.4.0

### Minor Changes

- feat: allow eval runs to select all workspace agents

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.3.0
  - @inspectr/mcplab-mcp-server@1.1.1
  - @inspectr/mcplab-reporting@1.1.2

## 1.3.0

### Minor Changes

- feat: add within-run side-by-side agent comparison mode
- feat: Show token consumption in results

## 1.2.0

### Minor Changes

- feat: persist MCP server versions in run results
- feat: refresh .env before each MCP server connection
- feat: add apiKeyHeaderName to app ServerConfig type
- feat: adapter support for bearer token field and api_key auth type
- docs: update auth examples for token field and api_key type
- fix: Toggle select all/clear for agent selection
- fix: List all configurations in the Eval run dropdown

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.2.0
  - @inspectr/mcplab-mcp-server@1.1.0
  - @inspectr/mcplab-reporting@1.1.1

## 1.1.0

### Minor Changes

- feat: Add eval run notes

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.1.0
  - @inspectr/mcplab-reporting@1.1.0
  - @inspectr/mcplab-mcp-server@1.0.1

## 1.0.1

### Patch Changes

- fix: increase auto-approved tool-call loop limit and remove redundant error check

## 1.0.0

### Major Changes

- Release 1.0.0
- feat: introduce run queuing system for job management
- feat: add "Add All Refs" button to import all library agent references
- feat: add run ID detection and link in MarkdownReports table
- fix: Ordering of test cases in scenario form

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@1.0.0
  - @inspectr/mcplab-mcp-server@1.0.0
  - @inspectr/mcplab-reporting@1.0.0

## 0.9.0

### Minor Changes

- - feat: support batch tool call approvals
  - feat: Improved error handling of eval runs
  - feat: normalize tool names in eval rule suggestions
  - fix: correct fallback display logic for user prompts

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@0.8.0
  - @inspectr/mcplab-mcp-server@0.3.4
  - @inspectr/mcplab-reporting@0.3.4

## 0.8.0

### Minor Changes

- fix: adjust default maxTurns to 30
  fix: refine component styling

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@0.7.0
  - @inspectr/mcplab-mcp-server@0.3.3
  - @inspectr/mcplab-reporting@0.3.3

## 0.7.0

### Minor Changes

- fix: increase default maxTurns from 8 to 15

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@0.6.0
  - @inspectr/mcplab-mcp-server@0.3.2
  - @inspectr/mcplab-reporting@0.3.2

## 0.6.2

### Minor Changes

- fix: simplify server name mapping in ScenarioAssistantDialog
- fix: unify server and agent ID usage across components

## 0.6.1

### Patch Changes

- fix: server name lookup in discoverToolsForAnalysis

## 0.6.0

### Minor Changes

- chore: Handle dangling tool calls in assistants
- fix: Improve config sorting

## 0.5.0

### Minor Changes

- chore: Add request ID tracking

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@0.5.0
  - @inspectr/mcplab-mcp-server@0.3.1
  - @inspectr/mcplab-reporting@0.3.1

## 0.4.0

### Minor Changes

- release 0.4.0

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@0.4.0
  - @inspectr/mcplab-mcp-server@0.3.0
  - @inspectr/mcplab-reporting@0.3.0

## 0.3.0

### Minor Changes

- release 0.3.0

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@0.3.0
  - @inspectr/mcplab-mcp-server@0.2.1
  - @inspectr/mcplab-reporting@0.2.1

## 0.2.0

### Minor Changes

- release 0.2.0

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@0.2.0
  - @inspectr/mcplab-mcp-server@0.2.0
  - @inspectr/mcplab-reporting@0.2.0

## 0.1.0

### Minor Changes

- release 0.1.0

### Patch Changes

- Updated dependencies
  - @inspectr/mcplab-core@0.1.0
  - @inspectr/mcplab-mcp-server@0.1.0
  - @inspectr/mcplab-reporting@0.1.0
