# Auth Improvements Design

## Goal

Support direct token values and `${VAR}` env var references across all auth types. Fix the confusing "API Key" auth type by replacing the OAuth CC mapping with a proper simple header-based API Key auth.

## Changes

### 1. `${VAR}` Pattern

Generic `resolveValue()` helper in core:
- `${VAR_NAME}` -> reads from `process.env`
- Plain string -> used as literal value
- `treatPlainAsEnvVar` flag for backward compat with OAuth CC fields

### 2. Bearer Token

Add optional `token` field to `ServerAuthBearer` alongside existing `env`:
- `token` resolved via `resolveValue()` (supports direct values and `${VAR}`)
- Legacy `env` field still works as fallback
- UI: single input next to auth type in 2-column grid

```yaml
auth:
  type: bearer
  token: ${DATABRICKS_TOKEN}   # env var
  # or
  token: dapi5ed3dc4f11a3cda64a  # direct value
```

### 3. New API Key Auth Type

New core type `ServerAuthApiKey`:
- `header_name`: custom header name (default `X-API-Key`)
- `value`: the key value, supports `${VAR}`
- Runtime: sets `headers[header_name] = resolvedValue`

```yaml
auth:
  type: api_key
  header_name: X-API-Key
  value: ${MY_API_KEY}
```

### 4. .env Refresh

Static `McpClientManager.onBeforeConnect` hook, set by CLI to `() => dotenv.config({ override: true })`. Called before each `connectAll()`.

### 5. UI

Auth dropdown: None | Bearer Token | API Key | OAuth 2.0 (same 4 options as today)

- **Bearer:** Token input inline with auth type (2-col grid). `${VAR}` hint.
- **API Key:** Header Name + Value fields. `${VAR}` hint. Replaces the old OAuth CC fields.
- **OAuth 2.0:** Unchanged.

Both `ServerDetail.tsx` and `ServerForm.tsx` updated.

### 6. Adapters

- Bearer: read `token` or wrap legacy `env: FOO` -> `${FOO}`. Write to `token`.
- API Key: new mapping `api_key` core <-> `api-key` app (replaces the old `oauth_client_credentials` mapping).
