export interface RouteMatch {
  name: string;
  params: Record<string, string>;
}
export function matchRoute(pathname: string, base?: string): RouteMatch;
export function parseQuery(search: string): Record<string, string>;
export function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string;
export function createNavigator(base: string, onChange: (route: RouteMatch & { query: Record<string, string>; path: string }) => void): {
  current(): RouteMatch & { query: Record<string, string>; path: string };
  go(to: string, replace?: boolean): void;
  href(to: string): string;
};
