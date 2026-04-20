import type { EvalDataSource } from './data-sources/types.js';

export async function waitForOAuthRuntimeSession(params: {
  sessionId: string;
  source: Pick<EvalDataSource, 'getOAuthRuntimeSession'>;
  serverName: string;
  onLaunchUrl?: (url: string) => void;
  timeoutMs?: number;
}): Promise<void> {
  const { sessionId, source, serverName, onLaunchUrl, timeoutMs = 5 * 60_000 } = params;
  const timeoutAt = Date.now() + timeoutMs;
  let completed = false;
  while (Date.now() < timeoutAt) {
    const { session } = await source.getOAuthRuntimeSession(sessionId);
    const launchUrl = session.authorizeLaunchUrl || session.authorizationUrl || '';
    if (launchUrl && onLaunchUrl) onLaunchUrl(launchUrl);
    if (session.status === 'completed' && session.hasAccessToken) {
      completed = true;
      break;
    }
    if (session.status === 'error' || session.status === 'stopped') {
      throw new Error(
        `OAuth login failed for '${serverName}' (${session.status}). ${session.lastError || ''}`.trim()
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
  }
  if (!completed) {
    throw new Error(
      `OAuth login timed out for '${serverName}'. Authorization was not completed within 5 minutes.`
    );
  }
}
