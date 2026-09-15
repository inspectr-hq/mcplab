import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createRoverConnectionService } from './rover-connection.js';

const servers: ReturnType<typeof createServer>[] = [];
const services: ReturnType<typeof createRoverConnectionService>[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) service.close();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) return resolve();
          server.close(() => resolve());
        })
    )
  );
});

async function connectRover(service: ReturnType<typeof createRoverConnectionService>) {
  const server = createServer();
  server.on('upgrade', (req, socket, head) => service.upgrade(req, socket, head));
  servers.push(server);
  services.push(service);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/rover/ws`);
  await once(socket, 'open');
  return socket;
}

describe('Rover connection protocol', () => {
  it('registers a provider, logs it, and dispatches messages', async () => {
    const log = vi.fn();
    const onRegister = vi.fn();
    const onMessage = vi.fn();
    const service = createRoverConnectionService({ log, onRegister, onMessage });
    const socket = await connectRover(service);
    socket.send(
      JSON.stringify({
        type: 'register',
        protocolVersion: 1,
        capabilities: ['scenario_control', 'assignment_lease'],
        provider: 'claude',
        providerRevision: 'rev-1',
        pageUrl: 'https://claude.ai/chat/1',
        extensionVersion: 'test'
      })
    );
    const [raw] = await once(socket, 'message');
    expect(JSON.parse(raw.toString()).type).toBe('registered');
    expect(service.connection()?.registration).toMatchObject({
      provider: 'claude',
      providerRevision: 'rev-1',
      capabilities: ['scenario_control', 'assignment_lease']
    });
    expect(JSON.parse(raw.toString())).toMatchObject({ capabilities: ['assignment_lease'] });
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[mcplab-app\] \[\d{4}-\d{2}-\d{2}T[^\]]+Z\] Rover connected: claude$/
      )
    );
    expect(onRegister).toHaveBeenCalledTimes(1);

    socket.send(JSON.stringify({ type: 'progress', jobId: 'job-1' }));
    await vi.waitFor(() =>
      expect(onMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'progress' })
      )
    );
    socket.close();
  });

  it('rejects malformed registrations and a second Rover connection', async () => {
    const service = createRoverConnectionService();
    const first = await connectRover(service);
    first.send(
      JSON.stringify({
        type: 'register',
        protocolVersion: 1,
        provider: 'claude',
        pageUrl: 'https://claude.ai',
        extensionVersion: '1'
      })
    );
    await once(first, 'message');

    const second = await connectRover(service);
    second.send(
      JSON.stringify({
        type: 'register',
        protocolVersion: 1,
        provider: 'trendminer',
        pageUrl: 'https://tm.example',
        extensionVersion: '1'
      })
    );
    const [raw] = await once(second, 'message');
    expect(JSON.parse(raw.toString())).toMatchObject({ type: 'rejected' });
    await once(second, 'close');
    first.close();
  });
});
