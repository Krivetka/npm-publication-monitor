// Parsing of the package name and the document revision — everything stage 1 knows
// about a package from the event itself.

export interface ParsedName {
  scope: string | null; // without '@'
  base: string;
  // namespace for "unrelated" publications: '@scope' or the name stem
  namespace: string;
  // name cluster: the first token of the base name, at least 3 characters long
  cluster: string | null;
}

export function nameTokens(base: string): string[] {
  return base.split(/[-._]+/).filter((t) => t !== '');
}

export function parseName(full: string): ParsedName {
  const lower = full.toLowerCase();
  let scope: string | null = null;
  let base = lower;
  if (lower.startsWith('@')) {
    const slash = lower.indexOf('/');
    if (slash > 1) {
      scope = lower.slice(1, slash);
      base = lower.slice(slash + 1);
    }
  }
  const first = nameTokens(base)[0];
  const cluster = first !== undefined && first.length >= 3 ? first : null;
  return { scope, base, namespace: scope !== null ? `@${scope}` : (cluster ?? base), cluster };
}

// "273-bbb8…" → 273: the number of updates of the package document in the registry
export function revNumber(rev: string): number | null {
  const m = /^(\d+)-/.exec(rev);
  return m ? Number(m[1]) : null;
}
