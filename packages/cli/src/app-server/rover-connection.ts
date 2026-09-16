import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { randomUUID } from 'node:crypto';
import { ROVER_CAPABILITIES, ROVER_PROTOCOL_VERSION as CORE_ROVER_PROTOCOL_VERSION } from '@inspectr/mcplab-core';

export type RoverProvider = string;
export const ROVER_ASSIGNMENT_LEASE_CAPABILITY = ROVER_CAPABILITIES[1];
export const ROVER_PROTOCOL_VERSION = CORE_ROVER_PROTOCOL_VERSION;

export interface RoverRegistration {
  protocolVersion: typeof ROVER_PROTOCOL_VERSION;
  provider: RoverProvider;
  providerRevision?: string;
  pageUrl: string;
  extensionVersion: string;
  capabilities: string[];
}

export interface RoverSocketMessage {
  type: string;
  [key: string]: unknown;
}

export type RoverRegistrationValidation =
  | { ok: true }
  | { ok: false; code: 'invalid_registration' | 'lease_required'; message: string };

export function validateRoverRegistration(message: Record<string, unknown>): RoverRegistrationValidation {
  if (
    message.type !== 'register' ||
    message.protocolVersion !== ROVER_PROTOCOL_VERSION ||
    typeof message.provider !== 'string' ||
    typeof message.pageUrl !== 'string' ||
    typeof message.extensionVersion !== 'string'
  ) {
    return { ok: false, code: 'invalid_registration', message: 'Rover registration required' };
  }
  if (!Array.isArray(message.capabilities) || !message.capabilities.includes(ROVER_ASSIGNMENT_LEASE_CAPABILITY)) {
    return { ok: false, code: 'lease_required', message: 'Rover assignment leases are required' };
  }
  return { ok: true };
}

export interface RoverConnection {
  connectionId: string;
  registration: RoverRegistration;
  socket: WebSocket;
  connectedAt: string;
  lastSeenAt: string;
}

export interface RoverConnectionService {
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  connection(): RoverConnection | null;
  send(message: RoverSocketMessage): boolean;
  broadcast(message: RoverSocketMessage): boolean;
  close(): void;
}

function timestampedLog(message: string): string {
  return `[mcplab-app] [${new Date().toISOString()}] ${message}`;
}

export function createRoverConnectionService(
  options: {
    log?: (message: string) => void;
    onRegister?: (connection: RoverConnection) => void | Promise<void>;
    onMessage?: (connection: RoverConnection, message: RoverSocketMessage) => void | Promise<void>;
    onDisconnect?: (connection: RoverConnection) => void | Promise<void>;
  } = {}
): RoverConnectionService {
  const log = options.log ?? console.log;
  const wss = new WebSocketServer({ noServer: true });
  let current: RoverConnection | null = null;
  let closed = false;
  const heartbeat = setInterval(() => {
    if (closed || !current) return;
    if (Date.now() - Date.parse(current.lastSeenAt) > 45_000) {
      current.socket.terminate();
      return;
    }
    if (current.socket.readyState === WebSocket.OPEN) current.socket.ping();
  }, 15_000);

  const parse = (raw: RawData): RoverSocketMessage | null => {
    try {
      const value = JSON.parse(raw.toString()) as unknown;
      return value &&
        typeof value === 'object' &&
        typeof (value as { type?: unknown }).type === 'string'
        ? (value as RoverSocketMessage)
        : null;
    } catch {
      return null;
    }
  };

  const send = (socket: WebSocket, message: RoverSocketMessage): boolean => {
    if (socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  wss.on('connection', (socket: WebSocket) => {
    let connection: RoverConnection | null = null;
    socket.on('message', (raw) => {
      const message = parse(raw);
      if (!message) {
        socket.close(1003, 'Invalid Rover message');
        return;
      }
      if (!connection) {
        const registrationError = validateRoverRegistration(message);
        if (!registrationError.ok && registrationError.code === 'invalid_registration') {
          socket.close(1008, registrationError.message);
          return;
        }
        if (!registrationError.ok) {
          send(socket, { type: 'rejected', reason: registrationError.message });
          socket.close(1008, registrationError.message);
          return;
        }
        if (current && current.socket.readyState === WebSocket.OPEN) {
          send(socket, { type: 'rejected', reason: 'another Rover is already connected' });
          socket.close(1008, 'Another Rover is already connected');
          return;
        }
        const now = new Date().toISOString();
        const provider = message.provider as string;
        const pageUrl = message.pageUrl as string;
        const extensionVersion = message.extensionVersion as string;
        connection = {
          connectionId: randomUUID(),
          registration: {
            protocolVersion: ROVER_PROTOCOL_VERSION,
            provider,
            ...(typeof message.providerRevision === 'string'
              ? { providerRevision: message.providerRevision }
              : {}),
            pageUrl,
            extensionVersion,
            capabilities: Array.isArray(message.capabilities)
              ? message.capabilities.filter((value): value is string => typeof value === 'string')
              : []
          },
          socket,
          connectedAt: now,
          lastSeenAt: now
        };
        current = connection;
        const registeredConnection = connection;
        send(socket, {
          type: 'registered',
          protocolVersion: ROVER_PROTOCOL_VERSION,
          connectedAt: now,
          capabilities: [ROVER_ASSIGNMENT_LEASE_CAPABILITY]
        });
        log(timestampedLog(`Rover connected: ${registeredConnection.registration.provider}`));
        void options.onRegister?.(registeredConnection);
        return;
      }
      connection.lastSeenAt = new Date().toISOString();
      if (message.type === 'register_update') {
        if (typeof message.provider !== 'string' || !message.provider.trim()) return;
        connection.registration = {
          ...connection.registration,
          provider: message.provider,
          ...(typeof message.providerRevision === 'string'
            ? { providerRevision: message.providerRevision }
            : {}),
          pageUrl: String(message.pageUrl ?? connection.registration.pageUrl)
        };
        send(socket, {
          type: 'registered',
          protocolVersion: ROVER_PROTOCOL_VERSION,
          connectedAt: connection.connectedAt,
          capabilities: [ROVER_ASSIGNMENT_LEASE_CAPABILITY]
        });
        log(
          timestampedLog(
            `Rover provider updated: ${connection.registration.provider} (${connection.registration.pageUrl})`
          )
        );
      }
      void options.onMessage?.(connection, message);
    });
    socket.on('close', () => {
      if (current?.socket !== socket) return;
      const disconnected = current;
      current = null;
      log(timestampedLog(`Rover disconnected: ${disconnected.registration.provider}`));
      void options.onDisconnect?.(disconnected);
    });
    socket.on('pong', () => {
      if (connection) connection.lastSeenAt = new Date().toISOString();
    });
    socket.on('error', () => undefined);
  });

  return {
    upgrade(req, socket, head) {
      if (closed || req.url?.split('?')[0] !== '/api/rover/ws') return false;
      wss.handleUpgrade(req, socket, head, (upgraded) => wss.emit('connection', upgraded, req));
      return true;
    },
    connection: () => current,
    send: (message) => (current ? send(current.socket, message) : false),
    broadcast: (message) => (current ? send(current.socket, message) : false),
    close: () => {
      closed = true;
      clearInterval(heartbeat);
      current?.socket.close(1001, 'MCPLab shutting down');
      current = null;
      wss.close();
    }
  };
}
