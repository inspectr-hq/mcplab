# OAuth Types Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add DCR (Dynamic Client Registration) mode and manual endpoint overrides to the OAuth Authorization Code flow in MCP Lab — both in the backend config schema and the frontend UI.

**Architecture:** Extend the existing `ServerAuthOauthAuthorizationCode` type with three optional fields (`mode`, `authorization_url`, `token_url`), mirror them in the frontend `ServerConfig`, update the two adapter serialization/deserialization paths, update the runtime session creator to route DCR vs pre_registered, then update the two UI forms (ServerDetail + ServerForm) with a mode toggle and a collapsed Advanced section.

**Tech Stack:** TypeScript, React, existing adapter pattern in `packages/app/src/lib/data-sources/adapters.ts`.

---

### Task 1: Extend `ServerAuthOauthAuthorizationCode` in core types

**Files:**
- Modify: `packages/core/src/types.ts` (lines 25–31)

**Step 1: Add three optional fields**

Current state of the interface (lines 25–31):
```typescript
export interface ServerAuthOauthAuthorizationCode {
  type: 'oauth_authorization_code';
  client_id: string;
  client_secret?: string;
  redirect_url?: string;
  scope?: string;
}
```

Change to:
```typescript
export interface ServerAuthOauthAuthorizationCode {
  type: 'oauth_authorization_code';
  mode?: 'pre_registered' | 'dcr';
  client_id?: string;
  client_secret?: string;
  redirect_url?: string;
  scope?: string;
  // Advanced: manual endpoint overrides when .well-known discovery fails
  authorization_url?: string;
  token_url?: string;
}
```

Note: `client_id` changes from required `string` to optional `string?` — DCR doesn't need one.

**Step 2: Verify TypeScript compiles**

```bash
cd packages/core && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat: extend ServerAuthOauthAuthorizationCode with mode, authorization_url, token_url"
```

---

### Task 2: Extend frontend `ServerConfig` type

**Files:**
- Modify: `packages/app/src/types/eval.ts` (lines 14–20)

**Step 1: Add three new fields**

After `oauthScope?: string;` (line 18), add:
```typescript
  oauthMode?: 'pre_registered' | 'dcr';
  oauthAuthorizationUrl?: string;
  oauthTokenEndpoint?: string;
```

The block should now look like:
```typescript
  // oauth2 (authorization code) fields
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRedirectUrl?: string;
  oauthScope?: string;
  oauthMode?: 'pre_registered' | 'dcr';
  oauthAuthorizationUrl?: string;
  oauthTokenEndpoint?: string;
  // oauth_client_credentials fields (used by libraries/YAML, not exposed in UI dropdown)
  oauthTokenUrl?: string;
```

**Step 2: Verify TypeScript compiles**

```bash
cd packages/app && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add packages/app/src/types/eval.ts
git commit -m "feat: add oauthMode, oauthAuthorizationUrl, oauthTokenEndpoint to ServerConfig"
```

---

### Task 3: Update adapters — deserialization (YAML → frontend)

**Files:**
- Modify: `packages/app/src/lib/data-sources/adapters.ts` (~lines 78–98)

**Step 1: Map new fields in deserialization block**

Current block (lines 78–98):
```typescript
      oauthClientId:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.client_id : undefined,
      oauthClientSecret:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.client_secret : undefined,
      oauthRedirectUrl:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.redirect_url : undefined,
      oauthScope:
        entry.auth?.type === 'oauth_authorization_code'
          ? entry.auth.scope
          : entry.auth?.type === 'oauth_client_credentials'
          ? entry.auth.scope
          : undefined,
```

Change to:
```typescript
      oauthClientId:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.client_id : undefined,
      oauthClientSecret:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.client_secret : undefined,
      oauthRedirectUrl:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.redirect_url : undefined,
      oauthScope:
        entry.auth?.type === 'oauth_authorization_code'
          ? entry.auth.scope
          : entry.auth?.type === 'oauth_client_credentials'
          ? entry.auth.scope
          : undefined,
      oauthMode:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.mode : undefined,
      oauthAuthorizationUrl:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.authorization_url : undefined,
      oauthTokenEndpoint:
        entry.auth?.type === 'oauth_authorization_code' ? entry.auth.token_url : undefined,
```

**Step 2: Verify TypeScript compiles**

```bash
cd packages/app && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add packages/app/src/lib/data-sources/adapters.ts
git commit -m "feat: deserialize oauthMode, oauthAuthorizationUrl, oauthTokenEndpoint from config"
```

---

### Task 4: Update adapters — serialization (frontend → YAML), two locations

**Files:**
- Modify: `packages/app/src/lib/data-sources/adapters.ts` (~lines 374–381 and ~568–575)

There are two `oauth2` serialization blocks — one in `mapInlineServer` (around line 374) and one in the full config export (around line 568). Both need the same changes.

**Step 1: Update first serialization block (~line 374)**

Current:
```typescript
        : server.authType === 'oauth2'
        ? {
            type: 'oauth_authorization_code' as const,
            client_id: server.oauthClientId || '',
            client_secret: server.oauthClientSecret || undefined,
            ...(server.oauthRedirectUrl ? { redirect_url: server.oauthRedirectUrl } : {}),
            scope: server.oauthScope || undefined
          }
```

Change to:
```typescript
        : server.authType === 'oauth2'
        ? {
            type: 'oauth_authorization_code' as const,
            ...(server.oauthMode === 'dcr' ? { mode: 'dcr' as const } : {}),
            ...(server.oauthMode !== 'dcr' && server.oauthClientId
              ? { client_id: server.oauthClientId }
              : {}),
            client_secret: server.oauthClientSecret || undefined,
            ...(server.oauthRedirectUrl ? { redirect_url: server.oauthRedirectUrl } : {}),
            scope: server.oauthScope || undefined,
            ...(server.oauthAuthorizationUrl
              ? { authorization_url: server.oauthAuthorizationUrl }
              : {}),
            ...(server.oauthTokenEndpoint ? { token_url: server.oauthTokenEndpoint } : {})
          }
```

**Step 2: Update second serialization block (~line 568)**

Current:
```typescript
              : server.authType === 'oauth2'
              ? {
                  type: 'oauth_authorization_code' as const,
                  client_id: server.oauthClientId || '',
                  client_secret: server.oauthClientSecret || undefined,
                  ...(server.oauthRedirectUrl ? { redirect_url: server.oauthRedirectUrl } : {}),
                  scope: server.oauthScope || undefined
                }
```

Change to:
```typescript
              : server.authType === 'oauth2'
              ? {
                  type: 'oauth_authorization_code' as const,
                  ...(server.oauthMode === 'dcr' ? { mode: 'dcr' as const } : {}),
                  ...(server.oauthMode !== 'dcr' && server.oauthClientId
                    ? { client_id: server.oauthClientId }
                    : {}),
                  client_secret: server.oauthClientSecret || undefined,
                  ...(server.oauthRedirectUrl ? { redirect_url: server.oauthRedirectUrl } : {}),
                  scope: server.oauthScope || undefined,
                  ...(server.oauthAuthorizationUrl
                    ? { authorization_url: server.oauthAuthorizationUrl }
                    : {}),
                  ...(server.oauthTokenEndpoint ? { token_url: server.oauthTokenEndpoint } : {})
                }
```

**Step 3: Verify TypeScript compiles**

```bash
cd packages/app && npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add packages/app/src/lib/data-sources/adapters.ts
git commit -m "feat: serialize oauthMode, oauthAuthorizationUrl, oauthTokenEndpoint to config"
```

---

### Task 5: Update oauth-runtime-domain to support DCR and endpoint overrides

**Files:**
- Modify: `packages/cli/src/app-server/oauth-runtime-domain.ts` (~lines 156–175)

**Step 1: Replace the hardcoded pre_registered config**

Current block (lines 156–175):
```typescript
  const config: OAuthDebuggerSessionConfigInput = {
    profile: 'latest',
    target: { serverName: params.serverName },
    registrationMethod: 'pre_registered',
    clientConfig: {
      preRegistered: {
        clientId: serverConfig.auth.client_id,
        clientSecret: serverConfig.auth.client_secret
      }
    },
    runtime: {
      redirectMode: 'local_callback',
      scopes: splitScopes(serverConfig.auth.scope),
      usePkce: true,
      codeChallengeMethod: 'S256'
    },
    display: {
      showSensitiveValues: false
    }
  };
```

Change to:
```typescript
  const isDcr = serverConfig.auth.mode === 'dcr' || !serverConfig.auth.client_id;

  const config: OAuthDebuggerSessionConfigInput = {
    profile: 'latest',
    target: {
      serverName: params.serverName,
      ...(serverConfig.auth.authorization_url || serverConfig.auth.token_url
        ? {
            overrides: {
              ...(serverConfig.auth.authorization_url
                ? { authorizationEndpoint: serverConfig.auth.authorization_url }
                : {}),
              ...(serverConfig.auth.token_url
                ? { tokenEndpoint: serverConfig.auth.token_url }
                : {})
            }
          }
        : {})
    },
    registrationMethod: isDcr ? 'dcr' : 'pre_registered',
    clientConfig: isDcr
      ? { dcr: { metadata: {} } }
      : {
          preRegistered: {
            clientId: serverConfig.auth.client_id!,
            clientSecret: serverConfig.auth.client_secret
          }
        },
    runtime: {
      redirectMode: 'local_callback',
      scopes: splitScopes(serverConfig.auth.scope),
      usePkce: true,
      codeChallengeMethod: 'S256'
    },
    display: {
      showSensitiveValues: false
    }
  };
```

**Step 2: Verify TypeScript compiles**

```bash
cd packages/cli && npx tsc --noEmit
```

Expected: no errors. If `overrides` is not a valid field on `target`, check `OAuthDebuggerSessionConfigInput` type and adjust the field names accordingly (look in `packages/cli/src/app-server/oauth-debugger-domain.ts` for the type definition or where `target` is typed).

**Step 3: Commit**

```bash
git add packages/cli/src/app-server/oauth-runtime-domain.ts
git commit -m "feat: support DCR and manual endpoint overrides in OAuth runtime sessions"
```

---

### Task 6: Update ServerDetail.tsx — OAuth UI with mode toggle and Advanced section

**Files:**
- Modify: `packages/app/src/pages/ServerDetail.tsx`

The current OAuth section shows: Client ID, Client Secret, Redirect URL, Scope. It needs:
1. A Pre-registered / DCR mode toggle at the top
2. Client ID + Secret only when mode is `pre_registered` (or unset)
3. A collapsed "Advanced" section with Authorization URL + Token URL fields

**Step 1: Locate the OAuth form section**

Search for `oauthClientId` in `ServerDetail.tsx` to find the form section. It should be around lines 480–525 based on the design doc.

**Step 2: Add `oauthMode` to the form state initializer**

Find where `form` state is initialized (likely in a `useState` or `useForm` call with `authType`, `oauthClientId`, etc.). Add `oauthMode` to both the initial state and the `setAuthType` handler reset block.

When initializing from `server`:
```typescript
oauthMode: server.oauthMode,
oauthAuthorizationUrl: server.oauthAuthorizationUrl,
oauthTokenEndpoint: server.oauthTokenEndpoint,
```

When resetting on authType change (in the handler that sets defaults when switching to `oauth2`):
```typescript
oauthMode: undefined,
oauthAuthorizationUrl: undefined,
oauthTokenEndpoint: undefined,
```

**Step 3: Add `showAdvancedOauth` state**

After the other state declarations (near where `authInProgress` is declared), add:
```typescript
const [showAdvancedOauth, setShowAdvancedOauth] = useState(false);
```

**Step 4: Replace the OAuth form fields block**

Find the block that renders the Client ID, Client Secret, Redirect URL, Scope fields for `form.authType === "oauth2"`. Replace it with:

```tsx
{form.authType === "oauth2" && (
  <div className="space-y-4">
    {/* Mode toggle */}
    <div className="space-y-1">
      <label className="text-sm font-medium">OAuth 2.0 Flow</label>
      <div className="flex gap-2">
        <Button
          type="button"
          variant={!form.oauthMode || form.oauthMode === "pre_registered" ? "default" : "outline"}
          size="sm"
          onClick={() => setForm((f) => ({ ...f, oauthMode: "pre_registered" }))}
        >
          Pre-registered
        </Button>
        <Button
          type="button"
          variant={form.oauthMode === "dcr" ? "default" : "outline"}
          size="sm"
          onClick={() => setForm((f) => ({ ...f, oauthMode: "dcr" }))}
        >
          DCR (Dynamic)
        </Button>
      </div>
    </div>

    {/* Client credentials — only for pre_registered */}
    {(!form.oauthMode || form.oauthMode === "pre_registered") && (
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Client ID *</label>
          <Input
            value={form.oauthClientId || ""}
            onChange={(e) => setForm((f) => ({ ...f, oauthClientId: e.target.value }))}
            placeholder="client-id"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Client Secret</label>
          <Input
            type="password"
            value={form.oauthClientSecret || ""}
            onChange={(e) => setForm((f) => ({ ...f, oauthClientSecret: e.target.value }))}
            placeholder="optional"
          />
        </div>
      </div>
    )}

    {/* Scope */}
    <div className="space-y-1">
      <label className="text-sm font-medium">Scope (optional, space-separated)</label>
      <Input
        value={form.oauthScope || ""}
        onChange={(e) => setForm((f) => ({ ...f, oauthScope: e.target.value }))}
        placeholder="openid email profile"
      />
    </div>

    {/* Advanced section */}
    <div>
      <button
        type="button"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setShowAdvancedOauth((v) => !v)}
      >
        <span>{showAdvancedOauth ? "▾" : "▸"}</span>
        Advanced — manual endpoint overrides
      </button>
      {showAdvancedOauth && (
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Authorization URL</label>
            <Input
              value={form.oauthAuthorizationUrl || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, oauthAuthorizationUrl: e.target.value || undefined }))
              }
              placeholder="leave blank to use .well-known discovery"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Token URL</label>
            <Input
              value={form.oauthTokenEndpoint || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, oauthTokenEndpoint: e.target.value || undefined }))
              }
              placeholder="leave blank to use .well-known discovery"
            />
          </div>
        </div>
      )}
    </div>
  </div>
)}
```

Note: Remove the old Redirect URL field from this block — it's no longer shown in the UI (the adapter omits it when absent; users who need it can set it in YAML directly).

**Step 5: Verify TypeScript compiles**

```bash
cd packages/app && npx tsc --noEmit
```

Expected: no errors.

**Step 6: Commit**

```bash
git add packages/app/src/pages/ServerDetail.tsx
git commit -m "feat: add OAuth mode toggle and Advanced endpoint overrides to Server Detail"
```

---

### Task 7: Update ServerForm.tsx — same OAuth UI changes

**Files:**
- Modify: `packages/app/src/components/config-editor/ServerForm.tsx`

This is the config editor form shown when creating/editing a server in the Config tab. It needs the same OAuth UI changes as `ServerDetail.tsx`.

**Step 1: Locate the OAuth section**

Search for `oauthClientId` in `ServerForm.tsx`. The OAuth section is around lines 184–233 per the design doc.

**Step 2: Add `showAdvancedOauth` state**

Near the top of the component (with other `useState` calls), add:
```typescript
const [showAdvancedOauth, setShowAdvancedOauth] = useState(false);
```

**Step 3: Ensure `oauthMode`, `oauthAuthorizationUrl`, `oauthTokenEndpoint` are in the form props**

`ServerForm` receives a `server: ServerConfig` prop. The fields are already in `ServerConfig` after Task 2. Ensure the component's `onChange` / `onSave` path passes them through, the same way it passes `oauthClientId`.

**Step 4: Replace the OAuth fields block**

Find the block that renders Client ID, Client Secret, Redirect URL, Scope. Replace with the same JSX as Task 6 Step 4 (copy-paste, adjusting `form` → the component's local state variable name if different).

The key fields to add/change:
- Mode toggle buttons (Pre-registered / DCR)
- Conditionally show Client ID + Secret only for pre_registered
- Scope field (unchanged)
- Collapsed Advanced section with Authorization URL + Token URL

**Step 5: Verify TypeScript compiles**

```bash
cd packages/app && npx tsc --noEmit
```

Expected: no errors.

**Step 6: Commit**

```bash
git add packages/app/src/components/config-editor/ServerForm.tsx
git commit -m "feat: add OAuth mode toggle and Advanced endpoint overrides to Server Form"
```

---

## Verification

After all tasks complete:

1. **Existing pre-registered config (no `mode` field)** — load a server YAML with `type: oauth_authorization_code` and `client_id` set, no `mode`. Server Detail should show Pre-registered mode with Client ID populated. Test Connection should work unchanged.

2. **DCR mode** — add `mode: dcr` to a server YAML (remove `client_id`). Server Detail should show DCR mode with no Client ID field. Test Connection should start OAuth without requiring client credentials.

3. **Manual endpoint overrides** — add `authorization_url` and `token_url` to a server YAML. Advanced section should expand showing the values. Test Connection should use those URLs instead of .well-known discovery.

4. **Round-trip via UI** — switch a server to DCR mode in the UI, save, reload. The `mode: dcr` field should be in the saved YAML.
