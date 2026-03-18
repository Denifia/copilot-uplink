import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import createDebug from 'debug';

const log = createDebug('uplink:pool');

export type ConnectionOrigin = 'local' | 'lan' | 'tunnel';

export interface ClientConnection {
  readonly id: string;
  readonly ws: WebSocket;
  readonly origin: ConnectionOrigin;
  readonly pendingSessionNewIds: Set<number | string>;
  readonly pendingSessionLoadIds: Set<number | string>;
}

/**
 * Manages a pool of connected WebSocket clients.
 *
 * Rules:
 * - Unlimited local (loopback) and LAN connections.
 * - At most one tunnel connection; a new tunnel evicts the existing one.
 */
export class ClientPool {
  private readonly _connections = new Map<string, ClientConnection>();

  /**
   * Classify the origin of an incoming WebSocket upgrade request.
   *
   * - `tunnel`: request carries `x-forwarded-for` or any `x-ms-devtunnel-*` header
   * - `local`: remoteAddress is a loopback address
   * - `lan`: everything else
   */
  static classifyOrigin(req: IncomingMessage): ConnectionOrigin {
    if (req.headers['x-forwarded-for']) return 'tunnel';
    for (const header of Object.keys(req.headers)) {
      if (header.startsWith('x-ms-devtunnel')) return 'tunnel';
    }
    const addr = req.socket.remoteAddress ?? '';
    if (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1') return 'local';
    return 'lan';
  }

  /**
   * Add a WebSocket to the pool. If the origin is `tunnel`, any existing
   * tunnel connection is closed first (same replacement behaviour as the
   * old single-socket design).
   */
  add(ws: WebSocket, origin: ConnectionOrigin): ClientConnection {
    if (origin === 'tunnel') {
      for (const conn of this._connections.values()) {
        if (conn.origin === 'tunnel') {
          log('evicting existing tunnel connection %s', conn.id);
          conn.ws.close(1000, 'Replaced by new tunnel connection');
          this._connections.delete(conn.id);
          break;
        }
      }
    }

    const id = randomBytes(4).toString('hex');
    const connection: ClientConnection = {
      id,
      ws,
      origin,
      pendingSessionNewIds: new Set(),
      pendingSessionLoadIds: new Set(),
    };
    this._connections.set(id, connection);
    log('added %s connection %s (total: %d)', origin, id, this._connections.size);
    return connection;
  }

  /** Remove a connection by ID (called on WebSocket close). */
  remove(id: string): void {
    if (this._connections.has(id)) {
      this._connections.delete(id);
      log('removed connection %s (total: %d)', id, this._connections.size);
    }
  }

  /** Send a message to every open connection. */
  broadcast(line: string): void {
    for (const conn of this._connections.values()) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(line);
      }
    }
  }

  /** Send a message to a single connection by ID (unicast). */
  sendTo(id: string, line: string): void {
    const conn = this._connections.get(id);
    if (conn?.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(line);
    }
  }

  /** Close every connection with the given code and reason, then clear the pool. */
  closeAll(code: number, reason: string): void {
    for (const conn of this._connections.values()) {
      if (
        conn.ws.readyState === WebSocket.OPEN ||
        conn.ws.readyState === WebSocket.CONNECTING
      ) {
        conn.ws.close(code, reason);
      }
    }
    this._connections.clear();
  }

  /** Returns true if at least one open connection exists. */
  hasAny(): boolean {
    for (const conn of this._connections.values()) {
      if (conn.ws.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  /** Number of connections currently in the pool (including non-open). */
  get size(): number {
    return this._connections.size;
  }

  /** Per-origin connection counts for diagnostics. */
  countByOrigin(): Record<ConnectionOrigin, number> {
    const counts: Record<ConnectionOrigin, number> = { local: 0, lan: 0, tunnel: 0 };
    for (const conn of this._connections.values()) {
      counts[conn.origin]++;
    }
    return counts;
  }

  [Symbol.iterator](): IterableIterator<ClientConnection> {
    return this._connections.values();
  }
}
