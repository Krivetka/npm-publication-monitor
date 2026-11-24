// Error handling of the whole application, in one place:
//   describeError   one sentence for the reader, by the kind and the status of the failure
//   notify, toasts  short messages at the edge of the screen (a tiny store)
//   ErrorBoundary   catches a failure while a page renders and offers a way out
//   installGlobalHandlers   failures nobody caught: logged and shown once

import { html } from 'htm/preact';
import { Component } from 'preact';

// ── what to tell the reader ──────────────────────────────────────────────────────────────
// `error` is an ApiError (it has a status), a network failure (TypeError of fetch) or a bug.
export function describeError(error) {
  const status = error && typeof error.status === 'number' ? error.status : null;
  const detail = error?.message ? String(error.message) : '';
  if (status === 400) return { title: 'The request was not accepted', text: detail || 'A parameter is wrong.', retry: false };
  if (status === 401) return { title: 'The analyst token is missing or wrong', text: 'Type the token again to store a verdict.', retry: false };
  if (status === 403) return { title: 'Not allowed', text: 'This instance does not allow the action.', retry: false };
  if (status === 404) return { title: 'Not found', text: detail || 'Nothing is stored under this address.', retry: false };
  if (status === 413) return { title: 'Too much data', text: 'The list or the text is larger than the server accepts.', retry: false };
  if (status !== null && status >= 500) return { title: 'The server failed', text: 'The request did not go through. It is safe to try again.', retry: true };
  if (status === 0) return { title: 'No connection to the server', text: 'Check the network; the page reconnects by itself.', retry: true };
  return { title: 'Something went wrong', text: detail || 'An unexpected error.', retry: true };
}

// ── toasts ───────────────────────────────────────────────────────────────────────────────
let toasts = [];
let nextId = 1;
const listeners = new Set();
const emit = () => {
  for (const fn of listeners) fn(toasts);
};

export const toastStore = {
  get: () => toasts,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
export function dismiss(id) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
// kind: 'error' | 'ok'. The same text is not stacked: a failing poll would fill the screen.
export function notify(kind, title, text = '', ttlMs = kind === 'error' ? 8000 : 4000) {
  if (toasts.some((t) => t.kind === kind && t.title === title && t.text === text)) return null;
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, kind, title, text }];
  emit();
  if (ttlMs > 0 && typeof setTimeout === 'function') setTimeout(() => dismiss(id), ttlMs);
  return id;
}
export function notifyError(error) {
  const d = describeError(error);
  return notify('error', d.title, d.text);
}

export function Toasts({ items, onDismiss = dismiss }) {
  return html`<div class="toasts" role="region" aria-label="Messages" aria-live="polite">
    ${items.map(
      (t) => html`<div class=${`toast ${t.kind}`} role=${t.kind === 'error' ? 'alert' : 'status'} key=${t.id}>
      <div><strong>${t.title}</strong>${t.text && html`<span>${t.text}</span>`}</div>
      <button type="button" class="toast-x" aria-label="Dismiss" onClick=${() => onDismiss(t.id)}>×</button>
    </div>`,
    )}
  </div>`;
}

// ── error boundary ───────────────────────────────────────────────────────────────────────
// A page that throws while it renders does not take the whole application down: the frame is
// replaced by a message, the failure is logged, and the reader can go on.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    logError('render', error);
  }
  componentDidUpdate(prev) {
    // a new route gets a fresh chance
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const d = describeError(error);
    return html`<div class="band"><div class="wrap hero"><div><h1>This page could not be shown</h1><p class="lead">${d.title}. ${d.text}</p></div>
      <div class="filters"><button type="button" class="btn-ghost" onClick=${() => this.setState({ error: null })}>Try again</button>
      <a class="fpill" href=${this.props.home ?? '/'}>Go to the overview</a></div></div></div>`;
  }
}

// ── logging and the last line of defence ─────────────────────────────────────────────────
export function logError(where, error) {
  // the console is the log of a browser application; the message keeps the place of the failure
  console.error(`[npm-monitor] ${where}:`, error);
}

export function installGlobalHandlers(target = globalThis) {
  if (typeof target.addEventListener !== 'function') return;
  target.addEventListener('error', (e) => {
    logError('uncaught', e.error ?? e.message);
    notifyError(e.error ?? new Error(String(e.message)));
  });
  target.addEventListener('unhandledrejection', (e) => {
    logError('unhandled promise', e.reason);
    notifyError(e.reason);
  });
}
