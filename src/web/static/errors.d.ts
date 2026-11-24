import type { Component, VNode } from 'preact';

export interface Described {
  title: string;
  text: string;
  retry: boolean;
}
export interface Toast {
  id: number;
  kind: 'error' | 'ok';
  title: string;
  text: string;
}
export function describeError(error: unknown): Described;
export const toastStore: { get(): Toast[]; subscribe(fn: (items: Toast[]) => void): () => void };
export function dismiss(id: number): void;
export function notify(kind: 'error' | 'ok', title: string, text?: string, ttlMs?: number): number | null;
export function notifyError(error: unknown): number | null;
export function Toasts(props: { items: Toast[]; onDismiss?: (id: number) => void }): VNode;
export class ErrorBoundary extends Component<{ resetKey?: string; home?: string; children?: unknown }, { error: unknown }> {
  static getDerivedStateFromError(error: unknown): { error: unknown };
  render(): VNode;
}
export function logError(where: string, error: unknown): void;
export function installGlobalHandlers(target?: { addEventListener?: (type: string, fn: (e: never) => void) => void }): void;
