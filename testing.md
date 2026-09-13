# MCPLab and Rover testing guide

This guide covers automated verification and manual acceptance scenarios for the MCPLab Browser Agent and Rover queue integration.

Repositories:

- MCPLab: `/Users/tim.haselaars/Sites/mcp-evaluation`
- Rover: `/Users/tim.haselaars/Sites/mcp-lab-rover`

Inspectr telemetry is intentionally excluded. Browser tool checks should remain `not_evaluated` until that separate phase is implemented.

## Prerequisites

- Node.js 20.19 or newer.
- npm dependencies installed in both repositories.
- Chrome 116 or newer for service-worker WebSocket support.
- A local MCPLab configuration with at least one response-only scenario.
- At least one Browser Agent in `mcplab/agents.yaml`.
- A matching built-in or learned provider in `mcplab/browser-providers.yaml` when using a learned provider.

Install dependencies if needed:

```bash
cd /Users/tim.haselaars/Sites/mcp-evaluation
npm install
cd /Users/tim.haselaars/Sites/mcp-lab-rover
npm install
```

## Automated verification

### MCPLab

```bash
cd /Users/tim.haselaars/Sites/mcp-evaluation
npm test
npm run build
git diff --check
```

Run an individual workspace while iterating:

```bash
npm test -w @inspectr/mcplab-app
npm test -w @inspectr/mcplab
npm test -w @inspectr/mcplab-core
npm test -w @inspectr/mcplab-mcp-server
npm test -w @inspectr/mcplab-website
```

### Rover

```bash
cd /Users/tim.haselaars/Sites/mcp-lab-rover
npm test
npm run typecheck
npm run build
git diff --check
```

The production extension is written to Rover's `dist/` directory. Reload the unpacked extension from `chrome://extensions` after each build.

## Start the local system

1. Start MCPLab:

   ```bash
   cd /Users/tim.haselaars/Sites/mcp-evaluation
   npm run app:dev
   ```

   Confirm that it is available at `http://127.0.0.1:8787`.

2. Build Rover:

   ```bash
   cd /Users/tim.haselaars/Sites/mcp-lab-rover
   npm run build
   ```

   In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select Rover's `dist/` directory.

3. Open a supported provider page in the active tab and open the injected Rover panel.

4. Confirm the MCPLab terminal logs timestamped lifecycle messages, for example:

   ```text
   [mcplab-app] [2026-09-13T12:34:56.789Z] Rover connected: chatgpt-com
   ```

## Manual validation scenarios

Record the date, provider, test case, browser version, and result URL for each run. Clear or stop an old queue before starting the next scenario.

### 1. Connection and provider detection

1. Start MCPLab and Rover.
2. Open a supported provider page.
3. Open Rover and wait for the green connected indicator.
4. Confirm the expected provider and active page are shown.
5. Confirm the terminal logs `Rover connected` with a timestamp.
6. Navigate to another conversation on the same provider.
7. Confirm the terminal logs `Rover provider updated` with the new URL.
8. Close or disable Rover and confirm `Rover disconnected` is logged.

Expected: MCPLab accepts one Rover connection, reports provider changes, and rejects a second simultaneous connection.

### 2. Manual response-only Live Test

1. Open a supported Claude, ChatGPT, or learned provider page.
2. Open Rover and use the Manual view.
3. Select a response-only evaluation and review the prompt.
4. Start the Live Test.
5. Confirm Rover sends the prompt to the active chat and captures the completed response.
6. Confirm Rover shows separate agent-running and MCPLab-evaluating states.
7. Confirm the outcome is `passed`, `failed`, `incomplete`, or `error`.
8. Open the result link and verify it opens in MCPLab.

Expected: one canonical result is created without queue children.

### 3. Learn and save a provider profile

Use this for a provider without a built-in adapter, such as M365 Copilot.

1. Open the target chat application.
2. Open Rover and choose **Learn**.
3. Start provider discovery.
4. Send a sample message and wait for a visible assistant response.
5. If possible, send a second sample turn so Rover can distinguish new responses from existing content.
6. Stop discovery after the response is complete.
7. Review composer, send, response, completion, and new-conversation capabilities.
8. Name the provider and choose **Save provider to MCPLab**.
9. Verify `browser-providers.yaml` and the linked Browser Agent are created or updated.
10. Reload Rover and confirm the provider is available without learning again.

Expected: the profile contains declarative locators and capabilities only. Re-learning updates the existing provider rather than creating a duplicate.

### 4. Queue one Rover evaluation with multiple scenarios

1. In MCPLab, open the evaluation queue page.
2. Select one Browser Agent and an evaluation with at least two response-only scenarios.
3. Queue the evaluation.
4. Confirm the evaluation card and a Rover job in `waiting_for_rover` when Rover is disconnected.
5. Click **Connect to Rover** if shown, open the provider URL, and toggle Rover.
6. Confirm the job changes to running and the first scenario is assigned.
7. Confirm prompt sent, response captured, evaluating, and persisted stages.
8. If fresh conversations are enabled, confirm Rover starts a new conversation before the next scenario.
9. Confirm the next scenario runs automatically and the result opens in MCPLab.

Expected: scenarios run in order, evaluated failures do not stop later scenarios, and all scenarios are stored in one canonical run directory.

### 5. Queue a learned M365 Copilot provider

1. Complete the learning scenario and verify the M365 Browser Agent references the saved provider ID.
2. Open the matching M365 Copilot conversation URL.
3. Queue a response-only evaluation for that Browser Agent.
4. Confirm the job waits for the matching Rover provider.
5. Toggle Rover while the M365 tab is active.
6. Confirm MCPLab assigns the job automatically and Rover sends the prompt.
7. Confirm only the newly created assistant response is captured.
8. Open the result URL.

Repeat once with the queue created while another tab is active. Rover should rebind to the matching active M365 tab rather than fail because of a stale tab ID.

### 6. Mixed LLM and Browser Agent evaluation

1. Configure one evaluation with at least one LLM Agent and one Browser Agent.
2. Queue the evaluation.
3. Confirm MCPLab creates separate execution jobs for the LLM and Rover agents.
4. Disconnect Rover and verify the LLM job continues while the Rover job waits.
5. Reconnect Rover and complete the Browser Agent scenarios.
6. Confirm parent progress includes both execution paths.
7. Open the result and verify both agents appear.
8. Confirm there is one `evaluationRunId` and one result directory.

Expected: execution is split, result persistence is not split.

### 7. Pause and explicit recovery

1. Start a multi-scenario Rover queue.
2. While a scenario is running, disable Rover or close its active provider tab.
3. Confirm MCPLab changes the job to `paused_rover` and records the reason.
4. Reopen the provider page and reconnect Rover.
5. Confirm the job remains paused until an explicit action is selected.
6. Click **Resume** or **Retry** and verify the active scenario runs once.
7. Repeat and choose **Skip**, then verify the next scenario starts.

Expected: reconnect does not silently resume work. Recovery is explicit and idempotent.

### 8. Stop and partial results

1. Start an evaluation with multiple scenarios.
2. Allow at least one scenario to complete.
3. Click the parent **Stop** control in MCPLab.
4. Confirm unfinished work stops and completed observations remain.
5. Open the partial result and verify completed and stopped scenario outcomes.

Expected: stopping does not delete completed observations or create a second result directory.

### 9. Rerun and result identity

1. Open a completed Rover result in MCPLab.
2. Choose **Run again**.
3. Confirm a new queue entry and evaluation execution are created.
4. Complete the rerun through Rover.
5. Confirm the rerun has a new run ID and correct Rover metadata.
6. Confirm the original result is unchanged.

### 10. Unsupported or attachment-based scenarios

1. Select an attachment-based case or a provider with no matching active page.
2. Confirm the catalog marks it ineligible or the queue explains why it cannot run.
3. Confirm MCPLab does not assign it to Rover.
4. For an unsupported page with manual capture, copy the prompt and paste the final response through the fallback.
5. Confirm response-only checks evaluate and tool-dependent checks remain `not_evaluated`.

### 11. Provider update and cache refresh

1. Re-learn a provider and save it to MCPLab.
2. Confirm MCPLab reports an update instead of a duplicate.
3. Keep Rover connected and wait for the provider update notification.
4. Confirm Rover refreshes its cached profile without a new queue assignment.
5. Run a new evaluation and verify the updated capability is used.

## Result and artifact checks

For each completed evaluation, verify the configured result directory contains:

```text
results/<evaluation-run-id>/
  results.json
  trace.jsonl
  summary.md
  resolved-config.yaml
  report.html
  execution-events.jsonl
```

Check `results.json`:

- `metadata.run_id` matches the MCPLab result URL.
- `metadata.execution_source` is `mcplab` or `rover` as appropriate.
- `scenarios[]` contains the expected scenario and agent identities.
- The outcome is `passed`, `failed`, `incomplete`, or `error`.
- Tool-dependent checks are `not_evaluated` without Inspectr observations.
- Reruns have a new run ID and do not overwrite earlier results.

## Reporting a failure

Include the MCPLab and Rover commits, browser and operating system versions, provider ID and origin, evaluation and scenario IDs, queue and Rover statuses, timestamped MCPLab logs, Rover Debug output, browser console errors, and the run ID and artifact path if a result was created.

Do not include credentials, access tokens, full chat transcripts, or private provider content in a bug report.
