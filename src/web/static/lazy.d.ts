import type { VNode } from 'preact';

export function lazy<M>(load: () => Promise<M>, pick: (module: M) => (props: never) => VNode): (props: Record<string, unknown>) => VNode;
