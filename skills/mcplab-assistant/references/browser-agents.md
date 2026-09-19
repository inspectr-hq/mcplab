# Browser Agents and Provider Profiles

Browser agents execute through MCPLab Rover. They are not LLM API clients and must not be selected as the Evaluation Judge.

## Workspace files

`agents.yaml` links a friendly agent id to a provider profile:

```yaml
custom-research-chat-browser:
  type: browser
  name: Custom Research Chat browser
  provider: custom-research-chat
  url: https://chat.example.test
  new_conversation_between_scenarios: true
```

`browser-providers.yaml` contains the deterministic interaction profile. The profile is provider-specific and must come from Rover capture, local validation, or an explicitly reviewed update. Do not copy the example values below into a real workspace.

## Provider profile shape

```yaml
custom-research-chat:
  schema_version: 1
  name: Custom Research Chat
  match:
    origins:
      - https://chat.example.test
      - https://workspace.chat.example.test
  composer:
    locator:
      segments:
        - main[data-app="chat"]
        - form[data-testid="composer-form"]
        - textarea[data-testid="prompt-input"]
    input_mode: textarea
  submit:
    action: click
    locator:
      segments:
        - form[data-testid="composer-form"]
        - button[data-testid="send-button"]
  assistant_messages:
    locator:
      segments:
        - main[data-app="chat"]
        - '[data-role="message"][data-author="assistant"]'
    text_locator:
      segments:
        - '[data-testid="message-content"]'
  completion:
    generating_locator:
      segments:
        - form[data-testid="composer-form"]
        - button[data-testid="send-button"][disabled]
    idle_locator:
      segments:
        - form[data-testid="composer-form"]
        - button[data-testid="send-button"]:not([disabled])
    stability_ms: 2500
  new_conversation:
    action: click
    locator:
      segments:
        - nav[data-testid="conversation-nav"]
        - button[data-testid="new-conversation"]
  learned:
    source_origin: https://chat.example.test
    created_at: 2026-09-17T00:00:00.000Z
    updated_at: 2026-09-17T00:00:00.000Z
    confidence:
      composer: high
      submit: high
      assistant: high
      completion: medium
```

## Field guidance

- `match.origins` contains origin-only URLs. Credentials, paths, query strings, and hashes are not valid profile origins.
- Locator `segments` are ordered CSS selectors from the document root toward the target. They must be syntactically valid and observed in the captured lifecycle trace.
- `composer.input_mode` is `input`, `textarea`, or `contenteditable`.
- `submit.action` is `click` or `enter`. Click submission requires a submit locator.
- `assistant_messages.locator` must select assistant-only messages, not user messages or the whole transcript.
- `assistant_messages.text_locator` is optional and narrows the text extraction inside each assistant message.
- `completion.generating_locator` should match an active generation state. `completion.idle_locator` should match a usable completion state. A stable response is accepted only after `stability_ms` has elapsed.
- `new_conversation` is optional. A navigation action requires a URL, while a click action requires a locator.
- `learned.confidence` contains only `high`, `medium`, or `low` values.
- Executable fields such as `script` and `script_source` are forbidden.

## AI-assisted provider refinement

The safe workflow is:

1. Rover captures a redacted interaction trace and proposes an initial profile.
2. MCPLab sends the profile and trace to the configured LLM Evaluation Judge when the user requests refinement.
3. The returned proposal is validated against the original trace by Rover before Save is enabled.
4. The validated profile is persisted to `browser-providers.yaml` and linked to a browser agent.

The Evaluation Judge may suggest selectors, but it never bypasses Rover replay validation. Do not save a profile from model output alone.

## Evaluation config

Reference the browser agent, not the provider profile, from an evaluation:

```yaml
agents:
  - ref: custom-research-chat-browser

scenarios:
  - ref: research-summary
    agent: custom-research-chat-browser
    mcp_servers:
      - ref: research-tools
```

Before queueing, confirm that:

- the browser agent id exists in `agents.yaml`;
- its provider id exists in `browser-providers.yaml`;
- Rover is connected to a matching browser origin;
- response assertions are appropriate for browser output;
- tool assertions are expected to be `not_evaluated` unless telemetry is available.
