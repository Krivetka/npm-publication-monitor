// Real-time stream: relays PostgreSQL notifications from the collector and the stages to
// WebSocket clients as JSON messages (see the OpenAPI description for the message types).

import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { type WebSocket, WebSocketServer } from 'ws';
import type { Sql } from '../db.ts';
import { errFields, log } from '../log.ts';
import { status as loadStatus } from '../web/queries.ts';
import { eventsBetween, maxSeq, stage1Summaries, stage2Summary } from './queries.ts';
import { type ApiEvent, type ApiStage1, type ApiStage2, type ApiStatus, toStatus } from './serialize.ts';

export const helloMessage = (lastSeq: number) => ({ type: 'hello' as const, last_seq: lastSeq });
export const eventMessage = (event: ApiEvent) => ({ type: 'event' as const, event });
export const stage1Message = (seq: number, stage1: ApiStage1) => ({ type: 'stage1' as const, seq, stage1 });
export const stage2Message = (seq: number, stage2: ApiStage2) => ({ type: 'stage2' as const, seq, stage2 });
export const statusMessage = (status: ApiStatus) => ({ type: 'status' as const, status });

// Payloads of the NOTIFY channels: 'feed' carries the last seq of the page, 'stage1' a JSON
// array of seqs, 'stage2' one seq.
export function parseSeqList(payload: string): number[] {
  try {
    const v: unknown = JSON.parse(payload);
    if (Array.isArray(v)) return v.filter((x): x is number => Number.isSafeInteger(x) && x >= 0);
    if (Number.isSafeInteger(v) && (v as number) >= 0) return [v as number];
  } catch {
    if (/^\d+$/.test(payload)) return [Number(payload)];
  }
  return [];
}

interface Client {
  ws: WebSocket;
  alive: boolean;
}

export class Realtime {
  private readonly sql: Sql;
  private readonly path: string;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  private readonly clients = new Set<Client>();
  private readonly maxClients: number;
  private lastBroadcast = 0;
  private chain: Promise<void> = Promise.resolve();
  private timers: NodeJS.Timeout[] = [];
  private listeners: { unlisten(): Promise<void> }[] = [];

  constructor(sql: Sql, path: string, maxClients = 50) {
    this.sql = sql;
    this.path = path;
    this.maxClients = maxClients;
  }

  get size(): number {
    return this.clients.size;
  }

  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== this.path) {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      if (this.clients.size >= this.maxClients) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnect(ws));
    });
  }

  async start(): Promise<void> {
    this.lastBroadcast = await maxSeq(this.sql);
    this.listeners.push(
      await this.sql.listen('feed', (p) => this.enqueue(() => this.onFeed(p))),
      await this.sql.listen('stage1', (p) => this.enqueue(() => this.onStage1(p))),
      await this.sql.listen('stage2', (p) => this.enqueue(() => this.onStage2(p))),
    );
    this.timers.push(
      setInterval(() => this.enqueue(() => this.onStatusTick()), 10_000),
      setInterval(() => this.keepalive(), 30_000),
    );
    log.info('realtime started', { path: this.path, lastSeq: this.lastBroadcast });
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    for (const c of this.clients) c.ws.close(1001, 'server shutting down');
    this.clients.clear();
    for (const l of this.listeners) await l.unlisten().catch(() => {});
    this.wss.close();
  }

  private onConnect(ws: WebSocket): void {
    const client: Client = { ws, alive: true };
    this.clients.add(client);
    ws.on('pong', () => (client.alive = true));
    ws.on('message', () => {}); // read-only stream: client messages are ignored
    ws.on('close', () => this.clients.delete(client));
    ws.on('error', () => this.clients.delete(client));
    this.send(client, helloMessage(this.lastBroadcast));
  }

  private send(client: Client, msg: unknown): void {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: unknown): void {
    if (this.clients.size === 0) return;
    const text = JSON.stringify(msg);
    for (const c of this.clients) if (c.ws.readyState === c.ws.OPEN) c.ws.send(text);
  }

  private keepalive(): void {
    for (const c of this.clients) {
      if (!c.alive) {
        c.ws.terminate();
        this.clients.delete(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }

  // Notifications are handled one at a time, in order.
  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch((e) => log.warn('realtime handler failed', errFields(e)));
  }

  private async onFeed(payload: string): Promise<void> {
    const [upTo] = parseSeqList(payload);
    if (upTo === undefined || upTo <= this.lastBroadcast) return;
    if (this.clients.size === 0) {
      this.lastBroadcast = upTo;
      return;
    }
    const events = await eventsBetween(this.sql, this.lastBroadcast, upTo, 2000);
    for (const e of events) this.broadcast(eventMessage(e));
    // advance only over rows actually seen: a notification can precede the rows' visibility
    this.lastBroadcast = events.at(-1)?.seq ?? this.lastBroadcast;
  }

  private async onStage1(payload: string): Promise<void> {
    if (this.clients.size === 0) return;
    const seqs = parseSeqList(payload);
    const rows = await stage1Summaries(this.sql, seqs);
    for (const [seq, s1] of rows) this.broadcast(stage1Message(seq, s1));
  }

  private async onStage2(payload: string): Promise<void> {
    if (this.clients.size === 0) return;
    const [seq] = parseSeqList(payload);
    if (seq === undefined) return;
    const s2 = await stage2Summary(this.sql, seq);
    if (s2) this.broadcast(stage2Message(seq, s2));
  }

  private async onStatusTick(): Promise<void> {
    if (this.clients.size === 0) return;
    this.broadcast(statusMessage(toStatus(await loadStatus(this.sql))));
  }
}
