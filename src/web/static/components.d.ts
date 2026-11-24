import type { VNode } from 'preact';

type Props = Record<string, unknown>;
export function href(to: string): string;
export function eventHref(seq: number): string;
export function packageHref(name: string): string;
export function Chips(props: Props): VNode[];
export function Meter(props: { value: number; scaleMax: number; threshold: number; hot?: boolean }): VNode;
export function Verdict(props: { row: Props }): VNode;
export function PipeTile(props: Props): VNode;
export function Empty(props: { icon?: string | null; title?: string; text: string }): VNode;
export function Loading(props: { text?: string; lines?: number }): VNode;
export function PageSkeleton(): VNode;
export function ErrorBox(props: { error: unknown; retry?: (() => void) | null }): VNode;
export function Field(props: { id: string; label: string; error?: string | null; hint?: string | null; children?: unknown }): VNode;
export function EventTable(props: { rows: Props[]; mode?: 'enriched' | 'stage1'; minWidth?: number }): VNode;
export function EventRow(props: { row: Props; mode: string }): VNode;
export function Pager(props: Props): VNode;
export function Pill(props: Props): VNode;
