import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppSettings } from './types.js';
import {
  GlobalCopilotThreadService,
  getGlobalCopilotMemoryRuntime
} from './global-copilot-memory.js';
import { globalCopilotWorkspaceResourceId } from './global-copilot-mastra.js';

type RouteParams = {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  method: string;
  settings: AppSettings;
  parseBody: (req: IncomingMessage) => Promise<Record<string, any>>;
  asJson: (res: ServerResponse, status: number, body: unknown) => void;
};

function serializeThread(thread: Awaited<ReturnType<GlobalCopilotThreadService['get']>>) {
  return {
    ...thread,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString()
  };
}

export async function handleGlobalCopilotThreadRoutes(params: RouteParams): Promise<boolean> {
  const collectionPath = '/api/global-copilot/threads';
  const match = params.pathname.match(/^\/api\/global-copilot\/threads\/([^/]+)$/);
  if (params.pathname !== collectionPath && !match) return false;

  const runtime = await getGlobalCopilotMemoryRuntime(params.settings.workspaceRoot);
  const service = new GlobalCopilotThreadService(
    runtime.memory,
    globalCopilotWorkspaceResourceId(params.settings.workspaceRoot)
  );

  try {
    if (params.pathname === collectionPath && params.method === 'GET') {
      params.asJson(params.res, 200, {
        threads: (await service.list()).map(serializeThread)
      });
      return true;
    }
    if (params.pathname === collectionPath && params.method === 'POST') {
      const body = await params.parseBody(params.req);
      const thread = await service.create({
        id: typeof body.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID(),
        title: typeof body.title === 'string' ? body.title : undefined
      });
      params.asJson(params.res, 201, { thread: serializeThread(thread), messages: [] });
      return true;
    }
    if (match) {
      const threadId = decodeURIComponent(match[1]);
      if (params.method === 'GET') {
        const thread = await service.get(threadId);
        const recalled = await runtime.memory.recall({
          threadId,
          resourceId: globalCopilotWorkspaceResourceId(params.settings.workspaceRoot),
          perPage: false
        });
        params.asJson(params.res, 200, {
          thread: serializeThread(thread),
          messages: recalled.messages
        });
        return true;
      }
      if (params.method === 'PATCH') {
        const body = await params.parseBody(params.req);
        const title = typeof body.title === 'string' ? body.title : '';
        params.asJson(params.res, 200, {
          thread: serializeThread(await service.rename(threadId, title))
        });
        return true;
      }
      if (params.method === 'DELETE') {
        await service.delete(threadId);
        params.res.statusCode = 204;
        params.res.end();
        return true;
      }
    }
    params.asJson(params.res, 405, { error: 'Method not allowed' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    params.asJson(params.res, message.startsWith('Global Copilot thread not found:') ? 404 : 400, {
      error: message
    });
  }
  return true;
}
