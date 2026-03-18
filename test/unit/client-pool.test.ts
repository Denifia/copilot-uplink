import { describe, it, expect, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { ClientPool, type ConnectionOrigin } from '../../src/server/client-pool.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal fake WebSocket with controllable readyState. */
function makeFakeWs(readyState: number = WebSocket.OPEN): WebSocket {
  const ws = {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocket;
  return ws;
}

/** Create a minimal IncomingMessage-like object for classifyOrigin tests. */
function makeFakeReq(opts: {
  remoteAddress?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  return {
    headers: opts.headers ?? {},
    socket: { remoteAddress: opts.remoteAddress },
  } as unknown as IncomingMessage;
}

// ─── classifyOrigin ──────────────────────────────────────────────────────────

describe('ClientPool.classifyOrigin', () => {
  it('returns tunnel when x-forwarded-for header is present', () => {
    const req = makeFakeReq({ headers: { 'x-forwarded-for': '1.2.3.4' }, remoteAddress: '5.6.7.8' });
    expect(ClientPool.classifyOrigin(req)).toBe('tunnel');
  });

  it('returns tunnel when x-ms-devtunnel-* header is present', () => {
    const req = makeFakeReq({ headers: { 'x-ms-devtunnel-id': 'abc123' }, remoteAddress: '5.6.7.8' });
    expect(ClientPool.classifyOrigin(req)).toBe('tunnel');
  });

  it('returns local for 127.0.0.1', () => {
    const req = makeFakeReq({ remoteAddress: '127.0.0.1' });
    expect(ClientPool.classifyOrigin(req)).toBe('local');
  });

  it('returns local for ::1 (IPv6 loopback)', () => {
    const req = makeFakeReq({ remoteAddress: '::1' });
    expect(ClientPool.classifyOrigin(req)).toBe('local');
  });

  it('returns local for ::ffff:127.0.0.1 (IPv4-mapped loopback)', () => {
    const req = makeFakeReq({ remoteAddress: '::ffff:127.0.0.1' });
    expect(ClientPool.classifyOrigin(req)).toBe('local');
  });

  it('returns lan for a LAN IP address', () => {
    const req = makeFakeReq({ remoteAddress: '192.168.1.42' });
    expect(ClientPool.classifyOrigin(req)).toBe('lan');
  });

  it('returns lan when remoteAddress is undefined', () => {
    const req = makeFakeReq({ remoteAddress: undefined });
    expect(ClientPool.classifyOrigin(req)).toBe('lan');
  });
});

// ─── add / remove / size ─────────────────────────────────────────────────────

describe('ClientPool add / remove / size', () => {
  it('starts empty', () => {
    const pool = new ClientPool();
    expect(pool.size).toBe(0);
    expect(pool.hasAny()).toBe(false);
  });

  it('adds a connection and increments size', () => {
    const pool = new ClientPool();
    const ws = makeFakeWs();
    pool.add(ws, 'local');
    expect(pool.size).toBe(1);
  });

  it('assigns a unique hex ID to each connection', () => {
    const pool = new ClientPool();
    const c1 = pool.add(makeFakeWs(), 'local');
    const c2 = pool.add(makeFakeWs(), 'lan');
    expect(c1.id).not.toBe(c2.id);
    expect(c1.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('stores origin on the connection object', () => {
    const pool = new ClientPool();
    const conn = pool.add(makeFakeWs(), 'lan');
    expect(conn.origin).toBe('lan');
  });

  it('initialises empty pending-ID sets on each connection', () => {
    const pool = new ClientPool();
    const conn = pool.add(makeFakeWs(), 'local');
    expect(conn.pendingSessionNewIds.size).toBe(0);
    expect(conn.pendingSessionLoadIds.size).toBe(0);
  });

  it('removes a connection by ID and decrements size', () => {
    const pool = new ClientPool();
    const conn = pool.add(makeFakeWs(), 'local');
    pool.remove(conn.id);
    expect(pool.size).toBe(0);
  });

  it('ignores remove() for an unknown ID', () => {
    const pool = new ClientPool();
    pool.add(makeFakeWs(), 'local');
    expect(() => pool.remove('nonexistent')).not.toThrow();
    expect(pool.size).toBe(1);
  });

  it('allows multiple local connections', () => {
    const pool = new ClientPool();
    pool.add(makeFakeWs(), 'local');
    pool.add(makeFakeWs(), 'local');
    expect(pool.size).toBe(2);
  });

  it('allows multiple LAN connections', () => {
    const pool = new ClientPool();
    pool.add(makeFakeWs(), 'lan');
    pool.add(makeFakeWs(), 'lan');
    expect(pool.size).toBe(2);
  });
});

// ─── tunnel eviction ─────────────────────────────────────────────────────────

describe('ClientPool tunnel eviction', () => {
  it('evicts the existing tunnel when a new tunnel connects', () => {
    const pool = new ClientPool();
    const oldTunnel = makeFakeWs();
    pool.add(oldTunnel, 'tunnel');
    expect(pool.size).toBe(1);

    const newTunnel = makeFakeWs();
    pool.add(newTunnel, 'tunnel');
    expect(pool.size).toBe(1);
    expect(oldTunnel.close).toHaveBeenCalledWith(1000, 'Replaced by new tunnel connection');
  });

  it('does not evict local connections when a tunnel connects', () => {
    const pool = new ClientPool();
    pool.add(makeFakeWs(), 'local');
    pool.add(makeFakeWs(), 'lan');
    const tunnel = makeFakeWs();
    pool.add(tunnel, 'tunnel');
    // local + lan survive; tunnel added → 3 total
    expect(pool.size).toBe(3);
  });

  it('allows a second tunnel after the first is removed', () => {
    const pool = new ClientPool();
    const first = pool.add(makeFakeWs(), 'tunnel');
    pool.remove(first.id);
    expect(() => pool.add(makeFakeWs(), 'tunnel')).not.toThrow();
    expect(pool.size).toBe(1);
  });
});

// ─── hasAny ──────────────────────────────────────────────────────────────────

describe('ClientPool hasAny', () => {
  it('returns false when pool is empty', () => {
    expect(new ClientPool().hasAny()).toBe(false);
  });

  it('returns true when at least one OPEN connection exists', () => {
    const pool = new ClientPool();
    pool.add(makeFakeWs(WebSocket.OPEN), 'local');
    expect(pool.hasAny()).toBe(true);
  });

  it('returns false when all connections are closed', () => {
    const pool = new ClientPool();
    pool.add(makeFakeWs(WebSocket.CLOSED), 'local');
    pool.add(makeFakeWs(WebSocket.CLOSING), 'lan');
    expect(pool.hasAny()).toBe(false);
  });
});

// ─── broadcast ───────────────────────────────────────────────────────────────

describe('ClientPool broadcast', () => {
  it('sends to all OPEN connections', () => {
    const pool = new ClientPool();
    const ws1 = makeFakeWs(WebSocket.OPEN);
    const ws2 = makeFakeWs(WebSocket.OPEN);
    pool.add(ws1, 'local');
    pool.add(ws2, 'lan');
    pool.broadcast('{"method":"ping"}');
    expect(ws1.send).toHaveBeenCalledWith('{"method":"ping"}');
    expect(ws2.send).toHaveBeenCalledWith('{"method":"ping"}');
  });

  it('skips non-OPEN connections', () => {
    const pool = new ClientPool();
    const openWs = makeFakeWs(WebSocket.OPEN);
    const closedWs = makeFakeWs(WebSocket.CLOSED);
    pool.add(openWs, 'local');
    pool.add(closedWs, 'lan');
    pool.broadcast('hello');
    expect(openWs.send).toHaveBeenCalledOnce();
    expect(closedWs.send).not.toHaveBeenCalled();
  });

  it('is a no-op when pool is empty', () => {
    expect(() => new ClientPool().broadcast('hello')).not.toThrow();
  });
});

// ─── sendTo ──────────────────────────────────────────────────────────────────

describe('ClientPool sendTo', () => {
  it('sends only to the specified connection', () => {
    const pool = new ClientPool();
    const ws1 = makeFakeWs();
    const ws2 = makeFakeWs();
    const c1 = pool.add(ws1, 'local');
    pool.add(ws2, 'lan');
    pool.sendTo(c1.id, 'unicast');
    expect(ws1.send).toHaveBeenCalledWith('unicast');
    expect(ws2.send).not.toHaveBeenCalled();
  });

  it('is a no-op for an unknown ID', () => {
    const pool = new ClientPool();
    expect(() => pool.sendTo('nope', 'hello')).not.toThrow();
  });

  it('skips a non-OPEN connection', () => {
    const pool = new ClientPool();
    const ws = makeFakeWs(WebSocket.CLOSED);
    const conn = pool.add(ws, 'local');
    pool.sendTo(conn.id, 'hello');
    expect(ws.send).not.toHaveBeenCalled();
  });
});

// ─── closeAll ────────────────────────────────────────────────────────────────

describe('ClientPool closeAll', () => {
  it('closes all OPEN connections with the given code and reason', () => {
    const pool = new ClientPool();
    const ws1 = makeFakeWs(WebSocket.OPEN);
    const ws2 = makeFakeWs(WebSocket.OPEN);
    pool.add(ws1, 'local');
    pool.add(ws2, 'tunnel');
    pool.closeAll(1001, 'shutting down');
    expect(ws1.close).toHaveBeenCalledWith(1001, 'shutting down');
    expect(ws2.close).toHaveBeenCalledWith(1001, 'shutting down');
  });

  it('closes CONNECTING connections too', () => {
    const pool = new ClientPool();
    const ws = makeFakeWs(WebSocket.CONNECTING);
    pool.add(ws, 'lan');
    pool.closeAll(1001, 'bye');
    expect(ws.close).toHaveBeenCalledOnce();
  });

  it('clears the pool after closing', () => {
    const pool = new ClientPool();
    pool.add(makeFakeWs(), 'local');
    pool.add(makeFakeWs(), 'lan');
    pool.closeAll(1001, 'bye');
    expect(pool.size).toBe(0);
  });

  it('is a no-op when pool is already empty', () => {
    expect(() => new ClientPool().closeAll(1000, 'ok')).not.toThrow();
  });
});

// ─── countByOrigin ───────────────────────────────────────────────────────────

describe('ClientPool countByOrigin', () => {
  it('returns zero counts for empty pool', () => {
    expect(new ClientPool().countByOrigin()).toEqual({ local: 0, lan: 0, tunnel: 0 });
  });

  it('counts connections by origin', () => {
    const pool = new ClientPool();
    pool.add(makeFakeWs(), 'local');
    pool.add(makeFakeWs(), 'local');
    pool.add(makeFakeWs(), 'lan');
    pool.add(makeFakeWs(), 'tunnel');
    expect(pool.countByOrigin()).toEqual({ local: 2, lan: 1, tunnel: 1 });
  });
});

// ─── Symbol.iterator ─────────────────────────────────────────────────────────

describe('ClientPool[Symbol.iterator]', () => {
  it('iterates over all connections', () => {
    const pool = new ClientPool();
    const origins: ConnectionOrigin[] = [];
    pool.add(makeFakeWs(), 'local');
    pool.add(makeFakeWs(), 'lan');
    pool.add(makeFakeWs(), 'tunnel');
    for (const conn of pool) {
      origins.push(conn.origin);
    }
    expect(origins.sort()).toEqual(['lan', 'local', 'tunnel']);
  });
});
