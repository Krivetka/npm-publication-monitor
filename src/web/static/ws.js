// Read-only WebSocket stream with reconnect, back-off and gap-free resume.
// Messages (see openapi.ts): hello {last_seq}, event {event}, stage1 {seq, stage1},
// stage2 {seq, stage2}, status {status}. One shared connection per page; views subscribe.

import { BASE } from './api.js';
import { logError } from './errors.js';

const listeners = new Set();
let socket = null;
let attempt = 0;
let timer = null;
let state = 'idle'; // idle | connecting | open | closed
let lastSeq = null; // newest seq seen (from hello or events) — resume point for backfill

export function subscribe(fn) {
  listeners.add(fn);
  ensure();
  return () => listeners.delete(fn);
}

export const wsState = () => state;
export const wsLastSeq = () => lastSeq;

function emit(msg) {
  for (const fn of listeners) {
    try {
      fn(msg);
    } catch (e) {
      logError('stream listener', e);
    }
  }
}

function ensure() {
  if (socket || timer) return;
  connect();
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state = 'connecting';
  emit({ type: '_state', state });
  try {
    socket = new WebSocket(`${proto}://${location.host}${BASE}/api/v1/ws`);
  } catch (_e) {
    socket = null;
    scheduleReconnect();
    return;
  }
  socket.onopen = () => {
    attempt = 0;
    state = 'open';
    emit({ type: '_state', state });
  };
  socket.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'hello') {
      const previous = lastSeq;
      lastSeq = msg.last_seq ?? lastSeq;
      // Tell views where the stream resumes so they can backfill GET /events?after=previous.
      emit({ type: '_resume', from: previous, last_seq: lastSeq });
      return;
    }
    if (msg.type === 'event' && msg.event && typeof msg.event.seq === 'number') {
      if (lastSeq === null || msg.event.seq > lastSeq) lastSeq = msg.event.seq;
    }
    emit(msg);
  };
  socket.onclose = () => {
    socket = null;
    state = 'closed';
    emit({ type: '_state', state });
    if (listeners.size > 0) scheduleReconnect();
  };
  socket.onerror = () => {
    /* onclose follows */
  };
}

function scheduleReconnect() {
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)) * (0.5 + Math.random());
  attempt++;
  timer = setTimeout(() => {
    timer = null;
    if (listeners.size > 0) connect();
  }, delay);
}
