#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { parse as parseQuery } from 'node:querystring';
import type { IncomingMessage } from 'node:http';
import {
  envServerOptions,
  readBody,
  requireBearer,
  sendJson,
  sendText,
  startManualMcpServer
} from './manual-test-shared.js';

type AuthCodeRecord = {
  clientId: string;
  redirectUri: string;
  scope?: string;
  codeChallenge?: string;
};

type ClientRecord = {
  clientId: string;
  clientSecret?: string;
  tokenEndpointAuthMethod?: string;
  redirectUris: string[];
};

function bodyForm(req: IncomingMessage, body: string): URLSearchParams {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(body);
  }
  const parsed = parseQuery(body);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'string') params.set(k, v);
  }
  return params;
}

function rand(prefix: string) {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

async function main() {
  const opts = envServerOptions(3113, 'mcplab-mcp-oauth-mock');
  const issuer = `http://${opts.host}:${opts.port}`;
  const preClientId = process.env.MCP_TEST_OAUTH_CLIENT_ID || 'mcplab-debugger';
  const preClientSecret = process.env.MCP_TEST_OAUTH_CLIENT_SECRET || 'mcplab-debugger-secret';
  const preRedirect = process.env.MCP_TEST_OAUTH_REDIRECT || 'http://localhost:6274/oauth/';
  const preScope = process.env.MCP_TEST_OAUTH_SCOPE || 'openid profile mcp';
  const tokenValue = process.env.MCP_TEST_OAUTH_ACCESS_TOKEN || 'demo-oauth-access-token';

  const clients = new Map<string, ClientRecord>();
  const codes = new Map<string, AuthCodeRecord>();
  clients.set(preClientId, {
    clientId: preClientId,
    clientSecret: preClientSecret,
    tokenEndpointAuthMethod: 'client_secret_basic',
    redirectUris: [preRedirect]
  });

  const runtime = await startManualMcpServer({
    ...opts,
    onRoot: (_req, res) => {
      sendJson(res, 200, {
        name: opts.name,
        kind: 'oauth-mock',
        issuer,
        mcp_endpoint: opts.mcpPath,
        oauth: {
          protected_resource_metadata: `${issuer}/.well-known/oauth-protected-resource`,
          authorization_server_metadata: `${issuer}/.well-known/oauth-authorization-server`,
          authorize: `${issuer}/authorize`,
          token: `${issuer}/token`,
          register: `${issuer}/register`,
          cimd: `${issuer}/client-metadata.json`
        },
        test_client: {
          client_id: preClientId,
          client_secret: preClientSecret,
          redirect_url: preRedirect,
          scope: preScope
        }
      });
    },
    beforeMcp: async (req, res, pathname, url) => {
      if (pathname === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
        sendJson(res, 200, {
          resource: issuer,
          authorization_servers: [issuer],
          bearer_methods_supported: ['header']
        });
        return true;
      }
      if (pathname === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
        sendJson(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'client_credentials'],
          token_endpoint_auth_methods_supported: [
            'none',
            'client_secret_basic',
            'client_secret_post'
          ],
          code_challenge_methods_supported: ['S256']
        });
        return true;
      }
      if (pathname === '/client-metadata.json' && req.method === 'GET') {
        sendJson(res, 200, {
          client_id: preClientId,
          redirect_uris: [preRedirect],
          token_endpoint_auth_method: 'client_secret_basic'
        });
        return true;
      }
      if (pathname === '/authorize' && req.method === 'GET') {
        const clientId = url.searchParams.get('client_id') || '';
        const redirectUri = url.searchParams.get('redirect_uri') || '';
        const responseType = url.searchParams.get('response_type') || '';
        const state = url.searchParams.get('state') || '';
        const codeChallenge = url.searchParams.get('code_challenge') || undefined;
        const scope = url.searchParams.get('scope') || undefined;
        const client = clients.get(clientId);
        if (!client || responseType !== 'code' || !redirectUri) {
          sendText(res, 400, 'invalid authorize request');
          return true;
        }
        if (!client.redirectUris.includes(redirectUri)) {
          sendText(res, 400, `redirect_uri not allowed: ${redirectUri}`);
          return true;
        }
        const code = rand('code');
        codes.set(code, { clientId, redirectUri, scope, codeChallenge });
        const redirect = new URL(redirectUri);
        redirect.searchParams.set('code', code);
        if (state) redirect.searchParams.set('state', state);
        res.statusCode = 302;
        res.setHeader('location', redirect.toString());
        res.end();
        return true;
      }
      if (pathname === '/register' && req.method === 'POST') {
        const raw = await readBody(req);
        let payload: any = {};
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          sendJson(res, 400, { error: 'invalid_client_metadata' });
          return true;
        }
        const clientId = rand('dcr_client');
        const clientSecret = rand('dcr_secret');
        const redirectUris = Array.isArray(payload.redirect_uris)
          ? payload.redirect_uris.filter((v: unknown) => typeof v === 'string')
          : [];
        clients.set(clientId, {
          clientId,
          clientSecret,
          tokenEndpointAuthMethod: payload.token_endpoint_auth_method || 'none',
          redirectUris
        });
        sendJson(res, 201, {
          client_id: clientId,
          client_secret: clientSecret,
          token_endpoint_auth_method: payload.token_endpoint_auth_method || 'none',
          redirect_uris: redirectUris
        });
        return true;
      }
      if (pathname === '/token' && req.method === 'POST') {
        const raw = await readBody(req);
        const params = bodyForm(req, raw);
        const grantType = params.get('grant_type') || '';
        if (grantType !== 'authorization_code') {
          sendJson(res, 400, { error: 'unsupported_grant_type' });
          return true;
        }
        const code = params.get('code') || '';
        const redirectUri = params.get('redirect_uri') || '';
        let clientId = params.get('client_id') || '';
        let clientSecret = params.get('client_secret') || undefined;

        const auth = String(req.headers.authorization || '');
        if (auth.startsWith('Basic ')) {
          try {
            const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
            const idx = decoded.indexOf(':');
            if (idx >= 0) {
              clientId = decoded.slice(0, idx);
              clientSecret = decoded.slice(idx + 1);
            }
          } catch {
            // ignore
          }
        }

        const client = clients.get(clientId);
        const record = codes.get(code);
        if (!client || !record) {
          sendJson(res, 400, { error: 'invalid_grant' });
          return true;
        }
        if (record.redirectUri !== redirectUri) {
          sendJson(res, 400, {
            error: 'invalid_grant',
            error_description: 'redirect_uri mismatch'
          });
          return true;
        }
        if (
          client.tokenEndpointAuthMethod !== 'none' &&
          client.clientSecret &&
          client.clientSecret !== clientSecret
        ) {
          sendJson(res, 401, { error: 'invalid_client' });
          return true;
        }
        const codeVerifier = params.get('code_verifier') || undefined;
        if (record.codeChallenge && !codeVerifier) {
          sendJson(res, 400, {
            error: 'invalid_request',
            error_description: 'missing code_verifier'
          });
          return true;
        }
        // Minimal mock: accept any code_verifier if a challenge was present.
        codes.delete(code);
        sendJson(res, 200, {
          access_token: tokenValue,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: record.scope || preScope
        });
        return true;
      }
      if (pathname === '/probe' && req.method === 'GET') {
        if (!requireBearer(req, res, tokenValue)) return true;
        sendJson(res, 200, { ok: true, issuer, protected: true });
        return true;
      }
      if (pathname === opts.mcpPath) {
        return !requireBearer(req, res, tokenValue);
      }
      return false;
    }
  });

  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error('[manual-test-oauth-mock] fatal:', error);
  process.exit(1);
});
