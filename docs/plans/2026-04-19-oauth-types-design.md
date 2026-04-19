# OAuth Types Design

## Context

MCP Lab currently supports only one OAuth 2.0 sub-type: pre-registered client (client_id + optional secret, endpoints discovered via `.well-known`). Claude Desktop exposes three modes — Dynamic discovery, Dynamic (DCR), and Manual endpoint config. With `.well-known` discovery now working correctly (including Keycloak path-based OIDC), the manual endpoint fields are not needed as a primary type, only as an advanced override fallback.

The two gaps to close:
1. **DCR (Dynamic Client Registration)** — server registers MCP Lab as a client dynamically; no `client_id` required from the user
2. **Manual endpoint overrides** — advanced fallback for when discovery fails (authorization_url, token_url)

---

## Design

### Config schema — `packages/core/src/types.ts`

Extend `ServerAuthOauthAuthorizationCode` with three optional fields. Fully backward compatible — existing configs unchanged.

```typescript
export interface ServerAuthOauthAuthorizationCode {
  type: 'oauth_authorization_code';
  mode?: 'pre_registered' | 'dcr';  // default: pre_registered
  client_id?: string;               // required for pre_registered, omitted for dcr
  client_secret?: string;
  redirect_url?: string;
  scope?: string;
  // Advanced: manual endpoint overrides when .well-known discovery fails
  authorization_url?: string;
  token_url?: string;
}
```

### Frontend type — `packages/app/src/types/eval.ts`

Add to `ServerConfig`:

```typescript
oauthMode?: 'pre_registered' | 'dcr';
oauthAuthorizationUrl?: string;   // manual authorization endpoint override
oauthTokenEndpoint?: string;      // manual token endpoint override
```

Note: `oauthTokenUrl` already exists and is used for `oauth_client_credentials` — keep it separate.

### UI — `packages/app/src/pages/ServerDetail.tsx` and `packages/app/src/components/config-editor/ServerForm.tsx`

Replace the existing OAuth 2.0 section with:

```
OAuth 2.0 Flow
[ Pre-registered ] [ DCR (Dynamic) ]   ← toggle/radio

// Pre-registered mode shows:
Client ID *           Client Secret (optional)
[_______________]     [_______________]

// DCR mode: no client credential fields shown

Scope (optional, space-separated)
[_________________________________]

▾ Advanced — manual endpoint overrides
  Authorization URL              Token URL
  [__________________________]   [__________________________]
  (leave blank to use .well-known discovery)
```

The Advanced section is collapsed by default. Both forms (ServerDetail and ServerForm) get the same treatment.

### Adapters — `packages/app/src/lib/data-sources/adapters.ts`

**Serialization** (two places, ~lines 374 and 568):
```typescript
server.authType === 'oauth2'
  ? {
      type: 'oauth_authorization_code' as const,
      ...(server.oauthMode === 'dcr' ? { mode: 'dcr' } : {}),
      ...(server.oauthMode !== 'dcr' && server.oauthClientId
        ? { client_id: server.oauthClientId }
        : {}),
      client_secret: server.oauthClientSecret || undefined,
      ...(server.oauthRedirectUrl ? { redirect_url: server.oauthRedirectUrl } : {}),
      scope: server.oauthScope || undefined,
      ...(server.oauthAuthorizationUrl ? { authorization_url: server.oauthAuthorizationUrl } : {}),
      ...(server.oauthTokenEndpoint ? { token_url: server.oauthTokenEndpoint } : {})
    }
```

**Deserialization** (~lines 55–90): map new fields back:
- `auth.mode` → `oauthMode`
- `auth.authorization_url` → `oauthAuthorizationUrl`
- `auth.token_url` → `oauthTokenEndpoint`

### Runtime domain — `packages/cli/src/app-server/oauth-runtime-domain.ts`

In `createOAuthRuntimeSession`, route based on `mode`:

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
  display: { showSensitiveValues: false }
};
```

---

## Critical Files

- `packages/core/src/types.ts` — `ServerAuthOauthAuthorizationCode` interface
- `packages/app/src/types/eval.ts` — `ServerConfig` interface
- `packages/app/src/pages/ServerDetail.tsx` — OAuth form section (~lines 480–525)
- `packages/app/src/components/config-editor/ServerForm.tsx` — OAuth form section (~lines 184–233)
- `packages/app/src/lib/data-sources/adapters.ts` — serialization (~374, ~568) and deserialization (~55–90)
- `packages/cli/src/app-server/oauth-runtime-domain.ts` — `createOAuthRuntimeSession`

## Verification

1. Existing pre-registered config (no `mode` field) → works unchanged
2. New DCR config (no `client_id`, `mode: 'dcr'`) → OAuth flow starts without requiring client credentials
3. Manual override fields (`authorization_url`, `token_url`) → passed to OAuth debugger session overrides, skip discovery
4. Test Connection on a Keycloak server with DCR enabled → completes without pre-configured client_id
