import type { IncomingMessage, ServerResponse } from 'node:http';
import { testDecisionConnection } from '@inspectr/mcplab-core';
import { asJson, parseBody } from './http.js';

export async function handleDecisionRoutes({
  req,
  res,
  pathname,
  method
}: {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
}): Promise<boolean> {
  if (pathname !== '/api/settings/decision/test' || method !== 'POST') return false;
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onClose);
  try {
    const result = await testDecisionConnection(await parseBody(req), controller.signal);
    if (!controller.signal.aborted) asJson(res, 200, result);
  } catch (error: unknown) {
    if (!controller.signal.aborted) {
      asJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    res.off('close', onClose);
  }
  return true;
}
