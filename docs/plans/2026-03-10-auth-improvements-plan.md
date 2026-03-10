# Auth Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support direct token values and `${VAR}` env var references in bearer/API key auth, add proper API Key auth type, and refresh `.env` before connections.

**Architecture:** Add `resolveValue()` helper to core `McpClientManager` that detects `${VAR}` patterns. Add `ServerAuthApiKey` core type for simple header-based auth. Update adapters to map between core YAML and app UI model. Update both UI forms.

**Tech Stack:** TypeScript, Vitest, React, Zod

---

### Task 1: Add `resolveValue()` helper and `token` field to bearer auth in core

**Files:**
- Modify: `packages/core/src/types.ts:3-6`
- Modify: `packages/core/src/mcp.ts`

**Step 1: Add `token` field to `ServerAuthBearer`**

In `packages/core/src/types.ts`, change:

```typescript
export interface ServerAuthBearer {
  type: 'bearer';
  env: string;
}
```

To:

```typescript
export interface ServerAuthBearer {
  type: 'bearer';
  env?: string;
  token?: string;
}
```

**Step 2: Add `resolveValue()` private method to `McpClientManager`**

In `packages/core/src/mcp.ts`, add this method to the `McpClientManager` class (before `getAuthHeaders`):

```typescript
/**
 * Resolve a config value that may contain a ${VAR} env-var reference.
 * - `${FOO}` → reads process.env.FOO
 * - plain string → returned as-is
 * - treatPlainAsEnvVar: legacy mode where plain strings are treated as env var names
 */
private resolveValue(value: string, label: string, treatPlainAsEnvVar = false): string {
  const envMatch = value.match(/^\$\{(.+)\}$/);
  if (envMatch) {
    const resolved = process.env[envMatch[1]];
    if (!resolved) {
      throw new Error(`Missing env var '${envMatch[1]}' for ${label}`);
    }
    return resolved;
  }
  if (treatPlainAsEnvVar) {
    const resolved = process.env[value];
    if (!resolved) {
      throw new Error(`Missing env var '${value}' for ${label}`);
    }
    return resolved;
  }
  return value;
}
```

**Step 3: Update bearer resolution in `getAuthHeaders`**

In `packages/core/src/mcp.ts`, replace the bearer block (currently reads `process.env[server.auth.env]`) with:

```typescript
if (server.auth.type === 'bearer') {
  let resolved: string | undefined;
  if (server.auth.token) {
    resolved = this.resolveValue(server.auth.token, 'bearer token');
  } else if (server.auth.env) {
    // Legacy: env field is always an env var name
    resolved = process.env[server.auth.env];
    if (!resolved) {
      throw new Error(`Missing bearer token env var: ${server.auth.env}`);
    }
  }
  if (!resolved) {
    throw new Error('No bearer token or env var configured');
  }
  headers['Authorization'] = `Bearer ${resolved}`;
  return headers;
}
```

**Step 4: Update OAuth CC to use `resolveValue` with `treatPlainAsEnvVar`**

In `packages/core/src/mcp.ts`, in `fetchOauthToken`, replace the direct `process.env` lookups:

```typescript
const clientId = process.env[server.auth.client_id_env];
const clientSecret = process.env[server.auth.client_secret_env];
if (!clientId) {
  throw new Error(`Missing OAuth client id env var: ${server.auth.client_id_env}`);
}
if (!clientSecret) {
  throw new Error(`Missing OAuth client secret env var: ${server.auth.client_secret_env}`);
}
```

With:

```typescript
const clientId = this.resolveValue(server.auth.client_id_env, 'OAuth client_id', true);
const clientSecret = this.resolveValue(server.auth.client_secret_env, 'OAuth client_secret', true);
```

**Step 5: Verify build**

Run: `cd packages/core && npx tsc -b`
Expected: No errors

**Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/mcp.ts
git commit -m "feat: add resolveValue helper and token field for bearer auth"
```

---

### Task 2: Add `ServerAuthApiKey` core type and runtime support

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/mcp.ts`

**Step 1: Add `ServerAuthApiKey` interface**

In `packages/core/src/types.ts`, add after `ServerAuthBearer`:

```typescript
export interface ServerAuthApiKey {
  type: 'api_key';
  header_name?: string;
  value: string;
}
```

**Step 2: Add to `ServerAuth` union**

Change:

```typescript
export type ServerAuth =
  | ServerAuthBearer
  | ServerAuthOauthClientCredentials
  | ServerAuthOauthAuthorizationCode;
```

To:

```typescript
export type ServerAuth =
  | ServerAuthBearer
  | ServerAuthApiKey
  | ServerAuthOauthClientCredentials
  | ServerAuthOauthAuthorizationCode;
```

**Step 3: Add runtime handling in `getAuthHeaders`**

In `packages/core/src/mcp.ts`, add after the bearer block and before the `oauth_client_credentials` block:

```typescript
if (server.auth.type === 'api_key') {
  const headerName = server.auth.header_name || 'X-API-Key';
  const resolved = this.resolveValue(server.auth.value, 'API key');
  headers[headerName] = resolved;
  return headers;
}
```

**Step 4: Verify build**

Run: `cd packages/core && npx tsc -b`
Expected: No errors

**Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/mcp.ts
git commit -m "feat: add api_key auth type with custom header support"
```

---

### Task 3: Add `.env` refresh hook

**Files:**
- Modify: `packages/core/src/mcp.ts`
- Modify: `packages/cli/src/cli.ts:2`
- Modify: `packages/cli/src/app-server/router.ts:1`

**Step 1: Add static `onBeforeConnect` hook to `McpClientManager`**

In `packages/core/src/mcp.ts`, add as a static property on the class:

```typescript
static onBeforeConnect: (() => void) | undefined;
```

**Step 2: Call the hook at the start of `connectAll`**

In `packages/core/src/mcp.ts`, add as the first line inside `connectAll()` (before `throwIfAborted`):

```typescript
McpClientManager.onBeforeConnect?.();
```

**Step 3: Change CLI dotenv import to programmatic**

In `packages/cli/src/cli.ts`, change:

```typescript
import 'dotenv/config';
```

To:

```typescript
import dotenv from 'dotenv';
dotenv.config();
```

**Step 4: Change router dotenv import and set the hook**

In `packages/cli/src/app-server/router.ts`, change:

```typescript
import 'dotenv/config';
```

To:

```typescript
import dotenv from 'dotenv';
dotenv.config();
```

Then in `startAppServer()`, add before the `const workspaceRoot` line:

```typescript
McpClientManager.onBeforeConnect = () => dotenv.config({ override: true });
```

(Make sure `McpClientManager` is imported — it already is via `@inspectr/mcplab-core`.)

**Step 5: Verify build**

Run: `cd packages/cli && npx tsc -b`
Expected: No errors

**Step 6: Commit**

```bash
git add packages/core/src/mcp.ts packages/cli/src/cli.ts packages/cli/src/app-server/router.ts
git commit -m "feat: refresh .env before each MCP server connection"
```

---

### Task 4: Update app types for API Key auth

**Files:**
- Modify: `packages/app/src/types/eval.ts:3-22`

**Step 1: Add API Key fields, clean up OAuth CC fields**

In `packages/app/src/types/eval.ts`, update the `ServerConfig` interface. Replace the `api-key` OAuth CC fields with proper API Key fields:

```typescript
export interface ServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  url?: string;
  command?: string;
  args?: string[];
  authType?: 'none' | 'bearer' | 'api-key' | 'oauth2';
  authValue?: string;
  // api-key fields
  apiKeyHeaderName?: string;
  // oauth2 (authorization code) fields
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRedirectUrl?: string;
  oauthScope?: string;
  // oauth_client_credentials fields (used by libraries/YAML, not exposed in UI dropdown)
  oauthTokenUrl?: string;
  oauthClientIdEnv?: string;
  oauthClientSecretEnv?: string;
  oauthAudience?: string;
}
```

Key changes:
- Add `apiKeyHeaderName?: string` for the custom header name
- `authValue` is reused for both bearer token and API key value
- Keep OAuth CC fields for backward compat with existing YAML configs that use `oauth_client_credentials`

**Step 2: Verify build**

Run: `cd packages/app && npx tsc -b`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/app/src/types/eval.ts
git commit -m "feat: add apiKeyHeaderName to app ServerConfig type"
```

---

### Task 5: Update adapters for bearer `token` field and API Key mapping

**Files:**
- Modify: `packages/app/src/lib/data-sources/adapters.ts`
- Modify: `packages/app/src/lib/data-sources/adapters.test.ts`

**Step 1: Write failing tests**

In `packages/app/src/lib/data-sources/adapters.test.ts`, add these tests (inside the existing `describe` block, after the existing OAuth CC test):

```typescript
it('round-trips bearer token with direct value', () => {
  const sourceRecord: WorkspaceConfigRecord = {
    id: 'cfg-bearer-direct',
    name: 'bearer-direct-test',
    path: '/tmp/bearer-direct.yaml',
    mtime: '2026-03-10T10:00:00.000Z',
    hash: 'hash-bd',
    config: {
      servers: [
        {
          id: 'my-server',
          name: 'My Server',
          transport: 'http',
          url: 'http://localhost:3000/mcp',
          auth: { type: 'bearer', token: 'my-secret-token-123' }
        }
      ],
      agents: [],
      scenarios: []
    }
  };
  const uiConfig = fromCoreConfigYaml(sourceRecord);
  const srv = uiConfig.servers.find((s) => s.id === 'my-server');
  expect(srv?.authType).toBe('bearer');
  expect(srv?.authValue).toBe('my-secret-token-123');

  const roundTripped = toCoreConfigYaml(uiConfig);
  const written = (roundTripped.servers as any[]).find((s: any) => s.id === 'my-server');
  expect(written?.auth).toEqual({ type: 'bearer', token: 'my-secret-token-123' });
});

it('round-trips bearer token with ${VAR} env reference', () => {
  const sourceRecord: WorkspaceConfigRecord = {
    id: 'cfg-bearer-env',
    name: 'bearer-env-test',
    path: '/tmp/bearer-env.yaml',
    mtime: '2026-03-10T10:00:00.000Z',
    hash: 'hash-be',
    config: {
      servers: [
        {
          id: 'env-server',
          name: 'Env Server',
          transport: 'http',
          url: 'http://localhost:3001/mcp',
          auth: { type: 'bearer', token: '${MY_TOKEN}' }
        }
      ],
      agents: [],
      scenarios: []
    }
  };
  const uiConfig = fromCoreConfigYaml(sourceRecord);
  const srv = uiConfig.servers.find((s) => s.id === 'env-server');
  expect(srv?.authType).toBe('bearer');
  expect(srv?.authValue).toBe('${MY_TOKEN}');

  const roundTripped = toCoreConfigYaml(uiConfig);
  const written = (roundTripped.servers as any[]).find((s: any) => s.id === 'env-server');
  expect(written?.auth).toEqual({ type: 'bearer', token: '${MY_TOKEN}' });
});

it('converts legacy bearer env field to ${VAR} syntax and writes back as token', () => {
  const sourceRecord: WorkspaceConfigRecord = {
    id: 'cfg-bearer-legacy',
    name: 'bearer-legacy-test',
    path: '/tmp/bearer-legacy.yaml',
    mtime: '2026-03-10T10:00:00.000Z',
    hash: 'hash-bl',
    config: {
      servers: [
        {
          id: 'legacy-server',
          name: 'Legacy Server',
          transport: 'http',
          url: 'http://localhost:3002/mcp',
          auth: { type: 'bearer', env: 'LEGACY_TOKEN' }
        }
      ],
      agents: [],
      scenarios: []
    }
  };
  const uiConfig = fromCoreConfigYaml(sourceRecord);
  const srv = uiConfig.servers.find((s) => s.id === 'legacy-server');
  expect(srv?.authType).toBe('bearer');
  expect(srv?.authValue).toBe('${LEGACY_TOKEN}');

  const roundTripped = toCoreConfigYaml(uiConfig);
  const written = (roundTripped.servers as any[]).find((s: any) => s.id === 'legacy-server');
  expect(written?.auth).toEqual({ type: 'bearer', token: '${LEGACY_TOKEN}' });
});

it('round-trips api_key auth type', () => {
  const sourceRecord: WorkspaceConfigRecord = {
    id: 'cfg-apikey',
    name: 'apikey-test',
    path: '/tmp/apikey.yaml',
    mtime: '2026-03-10T10:00:00.000Z',
    hash: 'hash-ak',
    config: {
      servers: [
        {
          id: 'apikey-server',
          name: 'API Key Server',
          transport: 'http',
          url: 'http://localhost:3003/mcp',
          auth: { type: 'api_key', header_name: 'X-Custom-Key', value: '${SECRET_KEY}' }
        }
      ],
      agents: [],
      scenarios: []
    }
  };
  const uiConfig = fromCoreConfigYaml(sourceRecord);
  const srv = uiConfig.servers.find((s) => s.id === 'apikey-server');
  expect(srv?.authType).toBe('api-key');
  expect(srv?.authValue).toBe('${SECRET_KEY}');
  expect(srv?.apiKeyHeaderName).toBe('X-Custom-Key');

  const roundTripped = toCoreConfigYaml(uiConfig);
  const written = (roundTripped.servers as any[]).find((s: any) => s.id === 'apikey-server');
  expect(written?.auth).toEqual({
    type: 'api_key',
    header_name: 'X-Custom-Key',
    value: '${SECRET_KEY}'
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/app && npx vitest run src/lib/data-sources/adapters.test.ts`
Expected: 4 new tests FAIL (bearer tests fail because `token` field not read, api_key test fails because type not mapped)

**Step 3: Update `fromCoreConfigYaml` — top-level server mapping**

In `packages/app/src/lib/data-sources/adapters.ts`, find the auth type mapping in the top-level server section (around line 48). Update:

The `authType` ternary — add `api_key`:

```typescript
const authType: 'none' | 'bearer' | 'api-key' | 'oauth2' =
  entry.auth?.type === 'bearer'
    ? 'bearer'
    : entry.auth?.type === 'api_key'
    ? 'api-key'
    : entry.auth?.type === 'oauth_client_credentials'
    ? 'api-key'
    : entry.auth?.type === 'oauth_authorization_code'
    ? 'oauth2'
    : 'none';
```

The `authValue` field — read `token` for bearer, `value` for api_key, and wrap legacy `env` in `${}`:

```typescript
authValue:
  entry.auth?.type === 'bearer'
    ? (entry.auth.token ?? (entry.auth.env ? `\${${entry.auth.env}}` : undefined))
    : entry.auth?.type === 'api_key'
    ? entry.auth.value
    : undefined,
```

Add `apiKeyHeaderName`:

```typescript
apiKeyHeaderName:
  entry.auth?.type === 'api_key' ? entry.auth.header_name : undefined,
```

**Step 4: Update `fromCoreConfigYaml` — scenario-owned server mapping**

Same changes in the scenario `mcp_servers` section (around line 162). Apply the same auth type, authValue, and apiKeyHeaderName logic.

**Step 5: Update `toCoreConfigYaml` — `mapInlineServer`**

In the `mapInlineServer` function (around line 318), change the bearer mapping from writing `env` to writing `token`:

```typescript
server.authType === 'bearer'
  ? { type: 'bearer' as const, token: server.authValue || '' }
```

Add the `api_key` case (before the existing `api-key` → `oauth_client_credentials` mapping):

When `server.authType === 'api-key'` AND `server.apiKeyHeaderName` is set (or no OAuth CC fields like `oauthTokenUrl`), write as `api_key`:

```typescript
: server.authType === 'api-key' && !server.oauthTokenUrl
? {
    type: 'api_key' as const,
    ...(server.apiKeyHeaderName ? { header_name: server.apiKeyHeaderName } : {}),
    value: server.authValue || ''
  }
: server.authType === 'api-key'
? {
    type: 'oauth_client_credentials' as const,
    token_url: server.oauthTokenUrl || '',
    client_id_env: server.oauthClientIdEnv || '',
    client_secret_env: server.oauthClientSecretEnv || '',
    ...(server.oauthScope ? { scope: server.oauthScope } : {}),
    ...(server.oauthAudience ? { audience: server.oauthAudience } : {})
  }
```

This preserves backward compat: existing configs that mapped `api-key` to `oauth_client_credentials` (with `oauthTokenUrl` set) still round-trip correctly.

**Step 6: Update `toCoreLibraries` — same auth mapping**

Apply the same bearer and api-key changes to the libraries auth mapping (around line 495).

**Step 7: Run tests**

Run: `cd packages/app && npx vitest run src/lib/data-sources/adapters.test.ts`
Expected: All tests pass including the 4 new ones

**Step 8: Commit**

```bash
git add packages/app/src/lib/data-sources/adapters.ts packages/app/src/lib/data-sources/adapters.test.ts
git commit -m "feat: adapter support for bearer token field and api_key auth type"
```

---

### Task 6: Update `ServerDetail.tsx` UI

**Files:**
- Modify: `packages/app/src/pages/ServerDetail.tsx`

**Step 1: Update `setAuthType` to clear API Key fields**

In the `setAuthType` handler (around line 65), update to clear API Key and OAuth CC fields when switching types:

```typescript
const setAuthType = (nextType: ServerConfig["authType"]) => {
  setForm((f) => ({
    ...f,
    authType: nextType,
    // Clear fields not relevant to the new type
    ...(nextType !== "bearer" && nextType !== "api-key"
      ? { authValue: undefined }
      : {}),
    ...(nextType !== "api-key"
      ? { apiKeyHeaderName: undefined }
      : {}),
    ...(nextType !== "oauth2"
      ? {
          oauthClientId: undefined,
          oauthClientSecret: undefined,
          oauthRedirectUrl: undefined,
          oauthScope: undefined,
        }
      : {
          oauthRedirectUrl: f.oauthRedirectUrl || "http://localhost:6274/oauth/",
        }),
  }));
};
```

**Step 2: Update bearer token input**

Replace the existing shared bearer/api-key input (around line 350, the block that shows for `form.authType !== "none" && form.authType !== "oauth2"`) with a bearer-specific input next to the auth type dropdown in the same 2-column grid:

```typescript
{form.authType === "bearer" && (
  <div className="space-y-1.5">
    <Label>Token</Label>
    <Input
      value={form.authValue || ""}
      onChange={(e) => setForm((f) => ({ ...f, authValue: e.target.value }))}
      placeholder="${DATABRICKS_TOKEN}"
      className="font-mono text-xs"
    />
  </div>
)}
```

**Step 3: Add `${VAR}` hint below the grid for bearer**

After the auth type grid div, add:

```typescript
{form.authType === "bearer" && (
  <p className="text-xs text-muted-foreground -mt-1">
    Use <code className="rounded bg-muted px-1">{`\${VAR_NAME}`}</code> to reference an environment variable, or enter a token directly.
  </p>
)}
```

**Step 4: Add API Key fields section**

After the bearer hint, add:

```typescript
{form.authType === "api-key" && (
  <div className="space-y-3 rounded-md border p-3">
    <div className="text-xs font-medium text-muted-foreground">API Key</div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs">Header Name</Label>
        <Input
          value={form.apiKeyHeaderName || "X-API-Key"}
          onChange={(e) => setForm((f) => ({ ...f, apiKeyHeaderName: e.target.value }))}
          placeholder="X-API-Key"
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Value</Label>
        <Input
          value={form.authValue || ""}
          onChange={(e) => setForm((f) => ({ ...f, authValue: e.target.value }))}
          placeholder="${MY_API_KEY}"
          className="font-mono text-xs"
        />
      </div>
    </div>
    <p className="text-xs text-muted-foreground">
      Use <code className="rounded bg-muted px-1">{`\${VAR_NAME}`}</code> to reference an environment variable, or enter a value directly.
    </p>
  </div>
)}
```

**Step 5: Verify build**

Run: `cd packages/app && npx tsc -b`
Expected: No errors

**Step 6: Commit**

```bash
git add packages/app/src/pages/ServerDetail.tsx
git commit -m "feat: update ServerDetail UI for bearer token and API key auth"
```

---

### Task 7: Update `ServerForm.tsx` UI

**Files:**
- Modify: `packages/app/src/components/config-editor/ServerForm.tsx`

**Step 1: Update `setAuthType` to clear API Key fields**

Same pattern as ServerDetail — clear `authValue`, `apiKeyHeaderName`, and oauth fields when switching:

```typescript
const setAuthType = (index: number, nextType: ServerConfig["authType"]) => {
  const current = servers[index];
  if (!current) return;
  update(index, {
    authType: nextType,
    ...(nextType !== "bearer" && nextType !== "api-key"
      ? { authValue: undefined }
      : {}),
    ...(nextType !== "api-key"
      ? { apiKeyHeaderName: undefined }
      : {}),
    ...(nextType !== "oauth2"
      ? {
          oauthClientId: undefined,
          oauthClientSecret: undefined,
          oauthRedirectUrl: undefined,
          oauthScope: undefined
        }
      : {
          oauthRedirectUrl: current.oauthRedirectUrl || "http://localhost:6274/oauth/"
        })
  });
};
```

**Step 2: Replace the shared bearer/api-key input with bearer-only inline**

In the auth type grid (around line 117), replace the shared input block with a bearer-only block:

```typescript
{srv.authType === "bearer" && (
  <div className="space-y-1.5">
    <Label className="text-xs">Token</Label>
    <Input
      value={srv.authValue || ""}
      onChange={(e) => update(i, { authValue: e.target.value })}
      disabled={readOnly}
      placeholder="${DATABRICKS_TOKEN}"
      className="font-mono text-xs"
    />
  </div>
)}
```

**Step 3: Add `${VAR}` hint for bearer**

```typescript
{srv.authType === "bearer" && (
  <p className="text-xs text-muted-foreground -mt-1">
    Use <code className="rounded bg-muted px-1">{`\${VAR_NAME}`}</code> to reference an environment variable, or enter a token directly.
  </p>
)}
```

**Step 4: Add API Key fields section**

```typescript
{srv.authType === "api-key" && (
  <div className="space-y-3 rounded-md border p-3">
    <div className="text-xs font-medium text-muted-foreground">API Key</div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs">Header Name</Label>
        <Input
          value={srv.apiKeyHeaderName || "X-API-Key"}
          onChange={(e) => update(i, { apiKeyHeaderName: e.target.value })}
          disabled={readOnly}
          placeholder="X-API-Key"
          className="font-mono text-xs"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Value</Label>
        <Input
          value={srv.authValue || ""}
          onChange={(e) => update(i, { authValue: e.target.value })}
          disabled={readOnly}
          placeholder="${MY_API_KEY}"
          className="font-mono text-xs"
        />
      </div>
    </div>
    <p className="text-xs text-muted-foreground">
      Use <code className="rounded bg-muted px-1">{`\${VAR_NAME}`}</code> to reference an environment variable, or enter a value directly.
    </p>
  </div>
)}
```

**Step 5: Verify build**

Run: `cd packages/app && npx tsc -b`
Expected: No errors

**Step 6: Commit**

```bash
git add packages/app/src/components/config-editor/ServerForm.tsx
git commit -m "feat: update ServerForm UI for bearer token and API key auth"
```

---

### Task 8: Update MCP Server tool schema

**Files:**
- Modify: `packages/mcp-server/src/runtime.ts`

**Step 1: Add `bearer_token` and `api_key` fields to zod schema**

In the `mcplab_generate_server_entry` input schema (around line 362), add:

```typescript
bearer_token: z
  .string()
  .optional()
  .describe('Direct bearer token value or ${VAR} env reference when auth_type=bearer.'),
api_key_header_name: z
  .string()
  .optional()
  .describe('Header name for API key auth (default: X-API-Key).'),
api_key_value: z
  .string()
  .optional()
  .describe('API key value or ${VAR} env reference when auth_type=api_key.'),
```

Add `'api_key'` to the `auth_type` enum:

```typescript
auth_type: z
  .enum(['none', 'bearer', 'api_key', 'oauth_client_credentials'])
  .optional()
  .describe('Authentication mode.'),
```

**Step 2: Update `buildServerEntry` function**

Add the types to the function signature and add the `api_key` case:

In the bearer case, use `bearer_token` if provided, falling back to wrapping `bearer_env` as `${VAR}`:

```typescript
if (authType === 'bearer') {
  const token = input.bearer_token
    ?? (input.bearer_env ? `\${${input.bearer_env}}` : undefined);
  if (!token) {
    throw new Error('bearer_token or bearer_env is required when auth_type=bearer');
  }
  return {
    transport,
    url: input.url,
    auth: { type: 'bearer', token }
  };
}
```

Add the `api_key` case before the `oauth_client_credentials` case:

```typescript
if (authType === 'api_key') {
  if (!input.api_key_value) {
    throw new Error('api_key_value is required when auth_type=api_key');
  }
  return {
    transport,
    url: input.url,
    auth: removeUndefined({
      type: 'api_key',
      header_name: input.api_key_header_name,
      value: input.api_key_value
    }) as EvalConfig['servers'][string]['auth']
  };
}
```

**Step 3: Verify build**

Run: `cd packages/mcp-server && npx tsc -b`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/mcp-server/src/runtime.ts
git commit -m "feat: add bearer_token and api_key to MCP server tool schema"
```

---

### Task 9: Update documentation

**Files:**
- Modify: `README.md`
- Modify: `packages/cli/README.md`

**Step 1: Update bearer auth examples**

Find existing bearer auth YAML examples in both READMEs and update them to show the new `token` field with both direct value and `${VAR}` syntax. Replace `env: MCP_TOKEN` with:

```yaml
auth:
  type: bearer
  token: ${MCP_TOKEN}        # env var reference
  # token: my-secret-token   # or direct value
```

**Step 2: Add API Key auth example**

Add an API Key example near the bearer example:

```yaml
auth:
  type: api_key
  header_name: X-API-Key     # optional, defaults to X-API-Key
  value: ${MY_API_KEY}
```

**Step 3: Commit**

```bash
git add README.md packages/cli/README.md
git commit -m "docs: update auth examples for token field and api_key type"
```

---

### Task 10: Final verification

**Step 1: Run full test suite**

Run: `cd packages/app && npx vitest run`
Expected: All tests pass

**Step 2: Run full type check**

Run: `npx tsc -b`
Expected: No errors

**Step 3: Manual smoke test (optional)**

Start the app and verify:
1. Create a server with Bearer auth → token input shows inline with `${VAR}` hint
2. Create a server with API Key auth → header name + value fields show with `${VAR}` hint
3. Switch between auth types → fields clear correctly
4. Save and reload → values preserved
