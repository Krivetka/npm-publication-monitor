export interface Point {
  label: string;
  value: number;
}
export interface Bar {
  i: number; x0: number; slot: number; bx: number; w: number; h: number; y: number; label: string; value: number; tickLabel: string | null;
}
export interface ColumnGeometry {
  W: number; H: number; L: number; T: number; plotW: number; plotH: number; max: number; rawMax: number; slot: number;
  ticks: { v: number; y: number; label: string }[]; bars: Bar[]; last: number; marker: number | null; y(v: number): number;
}
export function niceMax(max: number): number;
export function columnPath(x: number, y: number, w: number, h: number): string;
export function columnGeometry(points: Point[], opts?: { startAt?: number | null; labelEvery?: number }): ColumnGeometry;
export function sparkGeometry(values: number[]): { W: number; base: number; max: number; mid: number; midY: number; lastY: number; line: string; area: string } | null;
export interface TimelinePoint {
  version: string; t: number; kind: 'pub0' | 'pub1' | 'other' | 'removed' | 'event';
}
export function timelineLayout(points: TimelinePoint[], gap?: { from: number; to: number; label: string } | null): {
  W: number; X0: number; X1: number; AXIS: number; ticks: { x: number; label: string }[];
  dots: { x: number; y: number; r: number; kind: string; version: string; t: number }[]; bracket: { a: number; b: number; label: string } | null;
} | null;
export function ColumnChart(props: Record<string, unknown>): unknown;
export function Sparkline(props: Record<string, unknown>): unknown;
export function VersionTimeline(props: Record<string, unknown>): unknown;
