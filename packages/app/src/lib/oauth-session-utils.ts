import type { EvalDataSource } from './data-sources/types.js';
import { waitForOAuthRuntimeSession } from './oauth-runtime-utils.js';

const RECHECK_DELAY_MS = 250;

export async function ensureOAuthForServers(params: {
  serverNames: string[];
  source: Pick<EvalDataSource, 'ensureOAuthServers' | 'getOAuthRuntimeSession'>;
  onServerAuthStart?: (serverName: string) => void;
  onServerStatus?: (status: {
    serverName: string;
    status: 'ready' | 'auth_required' | 'not_oauth';
    debugState?: 'reused' | 'refreshed' | 'auth_required' | 'not_oauth';
    tokenExpiresAt?: string;
    tokenExpiresInSeconds?: number;
    message?: string;
  }) => void;
  timeoutMs?: number;
}): Promise<void> {
  const {
    serverNames,
    source,
    onServerAuthStart,
    onServerStatus,
    timeoutMs = 5 * 60_000
  } = params;
  const uniqueServerNames = Array.from(new Set(serverNames.filter(Boolean)));
  if (uniqueServerNames.length === 0) return;

  const timeoutAt = Date.now() + timeoutMs;
  const openedRuntimeSessions = new Set<string>();
  const emittedServerStates = new Map<string, string>();

  while (Date.now() < timeoutAt) {
    const ensured = await source.ensureOAuthServers({ serverNames: uniqueServerNames });
    for (const entry of ensured.servers) {
      const stateKey = `${entry.status}:${entry.debugState ?? ''}:${entry.runtimeSessionId ?? ''}`;
      if (emittedServerStates.get(entry.serverName) !== stateKey) {
        emittedServerStates.set(entry.serverName, stateKey);
        onServerStatus?.({
          serverName: entry.serverName,
          status: entry.status,
          debugState: entry.debugState,
          tokenExpiresAt: entry.tokenExpiresAt,
          tokenExpiresInSeconds: entry.tokenExpiresInSeconds,
          message: entry.message
        });
      }
    }
    const pending = ensured.servers.filter((entry) => entry.status === 'auth_required');
    if (pending.length === 0 && ensured.allReady) {
      return;
    }

    for (const entry of pending) {
      const runtimeSessionId = entry.runtimeSessionId;
      if (!runtimeSessionId) {
        throw new Error(entry.message || `OAuth login required for '${entry.serverName}'.`);
      }
      if (!openedRuntimeSessions.has(runtimeSessionId)) {
        openedRuntimeSessions.add(runtimeSessionId);
        onServerAuthStart?.(entry.serverName);
      }
      const openBrowserOnce = (() => {
        let opened = false;
        return (launchUrl: string) => {
          if (opened || !launchUrl) return;
          opened = true;
          const absoluteUrl = launchUrl.startsWith('http')
            ? launchUrl
            : `${window.location.origin}${launchUrl}`;
          window.open(absoluteUrl, '_blank', 'noopener,noreferrer');
        };
      })();
      openBrowserOnce(entry.authorizeLaunchUrl || entry.authorizationUrl || '');
      await waitForOAuthRuntimeSession({
        sessionId: runtimeSessionId,
        source,
        serverName: entry.serverName,
        onLaunchUrl: openBrowserOnce,
        timeoutMs: Math.max(10_000, timeoutAt - Date.now())
      });
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, RECHECK_DELAY_MS);
    });
  }

  throw new Error('OAuth login timed out before all required servers were authorized.');
}
