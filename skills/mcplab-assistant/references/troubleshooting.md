# Troubleshooting

Use this table to map symptoms to likely causes and fastest fixes.

## Common Failures

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| `fetch failed` | Server unavailable, wrong URL, or auth missing | Verify server is running, confirm `servers.<name>.url`, check auth env vars are set |
| `Unknown agents: ...` | `--agents` includes undefined agent key | Use only keys defined under `agents:` |
| Scenario not found/selected | Wrong `-s/--scenario` id | Use exact scenario `id` from config |
| `Runs must be a positive number` | `-n/--runs` is `0`, negative, or non-numeric | Set `-n` to integer `>= 1` |
| `Port must be a positive number` | Invalid `--port` value | Use port integer `>= 1` |
| OAuth token retrieval failures | Wrong token URL or missing client env vars | Confirm `token_url`, `client_id_env`, `client_secret_env`, scope/audience |
| Assertion failures with otherwise valid response | Regex/jsonpath mismatch | Update assertion pattern/path to match actual output format |

## Fast Triage Procedure

1. Capture exact command and full error text.
2. Confirm config references:
- scenario -> agent exists
- scenario -> server names exist
3. Validate auth env vars by name (never print secret values).
4. Re-run with minimal case:
- one scenario
- one agent
- one run
5. If failing, inspect `trace.jsonl` for last successful/failed tool step.

## Output-Driven Debugging

- `results.json`: check per-scenario fail reason, assertions, tool stats.
- `summary.md`: quick pass/fail and latency overview.
- `trace.jsonl`: exact sequence of LLM responses and tool calls.
- `report.html`: interactive filters for scenario and run analysis.

