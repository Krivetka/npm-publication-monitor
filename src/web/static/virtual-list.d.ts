export interface WindowRange {
  start: number;
  end: number;
  offsetTop: number;
  totalHeight: number;
}
export function windowRange(scrollTop: number, viewportHeight: number, rowHeight: number, total: number, overscan?: number): WindowRange;
export function VirtualList(props: Record<string, unknown>): unknown;
export function scrollListToTop(container: unknown): void;
