// Nominal lane: similarity of a name to the name of a popular package.
// Damerau–Levenshtein distance 1 (with separate kinds for transposition and adjacent key),
// homoglyphs, separators, token order, service affixes, scope substitution.
// Lookup goes through a deletion index (symmetric delete), without scanning the whole list.

import { nameTokens, parseName } from './names.ts';

export type NominalKind =
  | 'homoglyph'
  | 'scope_typo'
  | 'transposition'
  | 'keyboard'
  | 'separator'
  | 'edit'
  | 'reorder'
  | 'affix';

export interface NominalMatch {
  kind: NominalKind;
  target: string;
  targetRank: number;
  via?: string; // for scope_typo — how the scope differs from the real one
}

export interface PopularName {
  name: string;
  rank: number;
}

const PRIORITY: NominalKind[] = ['homoglyph', 'scope_typo', 'transposition', 'keyboard', 'separator', 'edit', 'reorder', 'affix'];

const KEY_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const ROW_SHIFT = [0, 0.5, 0.75, 1.25];
const KEY_POS = new Map<string, [number, number]>();
KEY_ROWS.forEach((row, r) => [...row].forEach((ch, c) => KEY_POS.set(ch, [r, c + ROW_SHIFT[r]!])));

export function keyboardAdjacent(a: string, b: string): boolean {
  const pa = KEY_POS.get(a);
  const pb = KEY_POS.get(b);
  if (!pa || !pb || a === b) return false;
  return Math.abs(pa[0] - pb[0]) <= 1 && Math.abs(pa[1] - pb[1]) <= 1;
}

// npm names are lowercase Latin, so homoglyphs here are ASCII look-alikes.
export function homoglyphKey(s: string): string {
  return s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/[1i]/g, 'l').replace(/3/g, 'e').replace(/5/g, 's');
}

const stripSeparators = (s: string): string => s.replace(/[-._]/g, '');

const AFFIXES = new Set(['js', 'node', 'nodejs', 'npm', 'cli', 'lib', 'pkg', 'dev', 'official']);

function coreTokens(base: string): string[] {
  return nameTokens(base).filter((t) => !AFFIXES.has(t));
}

function deletions(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.slice(0, i) + s.slice(i + 1));
  return out;
}

// The kind of the single edit between a and b, or null when there is more than one edit.
export function editKind(a: string, b: string): 'transposition' | 'keyboard' | 'edit' | null {
  if (a === b) return null;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length && diff.length <= 2; i++) if (a[i] !== b[i]) diff.push(i);
    const [i, j] = diff;
    if (diff.length === 1 && i !== undefined) return keyboardAdjacent(a[i]!, b[i]!) ? 'keyboard' : 'edit';
    if (diff.length === 2 && i !== undefined && j === i + 1 && a[i] === b[j] && a[j] === b[i]) return 'transposition';
    return null;
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  if (l.length - s.length !== 1) return null;
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1) ? 'edit' : null;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) {
    if (!list.includes(value)) list.push(value);
  } else map.set(key, [value]);
}

export class NameIndex {
  readonly size: number;
  private readonly rankOf = new Map<string, number>();
  private readonly minLength: number;
  // unscoped names
  private readonly byDeletion = new Map<string, string[]>();
  private readonly byHomoglyph = new Map<string, string[]>();
  private readonly bySeparator = new Map<string, string[]>();
  private readonly byReorder = new Map<string, string[]>();
  private readonly byAffix = new Map<string, string[]>();
  // scopes of popular packages and their base names
  private readonly scopeBases = new Map<string, Set<string>>();
  private readonly scopeByDeletion = new Map<string, string[]>();
  private readonly scopeByHomoglyph = new Map<string, string[]>();
  private readonly scopeBySeparator = new Map<string, string[]>();

  constructor(popular: PopularName[], minLength = 4) {
    this.minLength = minLength;
    for (const { name, rank } of popular) {
      const lower = name.toLowerCase();
      if (this.rankOf.has(lower)) continue;
      this.rankOf.set(lower, rank);
      const { scope, base } = parseName(lower);

      if (scope !== null) {
        let bases = this.scopeBases.get(scope);
        if (!bases) {
          bases = new Set();
          this.scopeBases.set(scope, bases);
          if (scope.length >= 3) {
            push(this.scopeByDeletion, scope, scope);
            for (const d of deletions(scope)) push(this.scopeByDeletion, d, scope);
          }
          push(this.scopeByHomoglyph, homoglyphKey(scope), scope);
          push(this.scopeBySeparator, stripSeparators(scope), scope);
        }
        bases.add(base);
        continue;
      }

      if (lower.length < minLength) continue;
      push(this.byDeletion, lower, lower);
      for (const d of deletions(lower)) push(this.byDeletion, d, lower);
      push(this.byHomoglyph, homoglyphKey(lower), lower);
      push(this.bySeparator, stripSeparators(lower), lower);
      const tokens = nameTokens(lower);
      if (tokens.length >= 2) push(this.byReorder, [...tokens].sort().join('-'), lower);
      const core = coreTokens(lower);
      if (core.length > 0) push(this.byAffix, core.join('-'), lower);
    }
    this.size = this.rankOf.size;
  }

  rank(name: string): number | undefined {
    return this.rankOf.get(name.toLowerCase());
  }

  match(name: string): NominalMatch | null {
    const lower = name.toLowerCase();
    if (this.rankOf.has(lower)) return null;
    const { scope, base } = parseName(lower);
    const found: NominalMatch[] = [];
    if (scope !== null) this.matchScope(scope, base, found);
    else this.matchUnscoped(lower, found);
    return pickBest(found);
  }

  private add(found: NominalMatch[], kind: NominalKind, target: string, via?: string): void {
    const targetRank = this.rankOf.get(target);
    if (targetRank !== undefined) found.push({ kind, target, targetRank, ...(via ? { via } : {}) });
  }

  private matchUnscoped(q: string, found: NominalMatch[]): void {
    if (q.length < this.minLength - 1) return;
    for (const p of this.byHomoglyph.get(homoglyphKey(q)) ?? []) if (p !== q) this.add(found, 'homoglyph', p);

    const seen = new Set<string>();
    for (const key of [q, ...deletions(q)]) {
      for (const p of this.byDeletion.get(key) ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        const kind = editKind(q, p);
        if (kind) this.add(found, kind, p);
      }
    }

    for (const p of this.bySeparator.get(stripSeparators(q)) ?? []) if (p !== q) this.add(found, 'separator', p);

    const tokens = nameTokens(q);
    if (tokens.length >= 2) {
      for (const p of this.byReorder.get([...tokens].sort().join('-')) ?? []) {
        if (p !== q) this.add(found, 'reorder', p);
      }
    }
    const core = coreTokens(q);
    if (core.length > 0 && core.length < tokens.length) {
      for (const p of this.byAffix.get(core.join('-')) ?? []) if (p !== q) this.add(found, 'affix', p);
    }
  }

  // The scope resembles a popular package's scope and the base name matches: @typescript_eslint/parser.
  private matchScope(scope: string, base: string, found: NominalMatch[]): void {
    const candidates = new Map<string, string>();
    for (const key of [scope, ...deletions(scope)]) {
      for (const s of this.scopeByDeletion.get(key) ?? []) {
        const kind = editKind(scope, s);
        if (kind) candidates.set(s, kind);
      }
    }
    for (const s of this.scopeByHomoglyph.get(homoglyphKey(scope)) ?? []) candidates.set(s, 'homoglyph');
    for (const s of this.scopeBySeparator.get(stripSeparators(scope)) ?? []) candidates.set(s, 'separator');
    for (const [s, via] of candidates) {
      if (s !== scope && this.scopeBases.get(s)?.has(base)) this.add(found, 'scope_typo', `@${s}/${base}`, via);
    }
  }
}

function pickBest(found: NominalMatch[]): NominalMatch | null {
  let best: NominalMatch | null = null;
  for (const m of found) {
    if (
      best === null ||
      PRIORITY.indexOf(m.kind) < PRIORITY.indexOf(best.kind) ||
      (m.kind === best.kind && m.targetRank < best.targetRank)
    ) {
      best = m;
    }
  }
  return best;
}
