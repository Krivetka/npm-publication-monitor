// Top npm packages by monthly downloads from ecosyste.ms, and snapshots of that list in the DB.
// The package_names endpoint returns only names in the same order: 20 KB per thousand
// versus 115 MB from /packages with full metadata.

import type { Sql } from '../db.ts';
import type { PopularName } from '../stage1/nominal.ts';

const API = 'https://packages.ecosyste.ms/api/v1/registries/npmjs.org/package_names';
const PAGE = 1000;

export interface PopularRow {
  name: string;
  downloads: number | null;
}

export async function fetchTopPackages(count: number, timeoutMs: number, signal?: AbortSignal): Promise<PopularRow[]> {
  const rows: PopularRow[] = [];
  const seen = new Set<string>();
  for (let page = 1; rows.length < count; page++) {
    const url = `${API}?sort=downloads&order=desc&per_page=${PAGE}&page=${page}`;
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'npm-publish-monitor/0.1 (research)' },
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
    });
    if (!res.ok) throw new Error(`ecosyste.ms: HTTP ${res.status} on page ${page}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error(`ecosyste.ms: page ${page} is not an array`);
    for (const name of body) {
      if (typeof name !== 'string' || seen.has(name)) continue;
      seen.add(name);
      rows.push({ name, downloads: null });
    }
    if (body.length < PAGE) break;
  }
  return rows.slice(0, count);
}

export async function storeSnapshot(sql: Sql, snapshot: string, rows: PopularRow[], keep: number): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`delete from popular_package where snapshot = ${snapshot}`;
    const values = rows.map((r, i) => ({ snapshot, rank: i + 1, name: r.name, downloads: r.downloads }));
    for (let i = 0; i < values.length; i += 5000) {
      await tx`insert into popular_package ${tx(values.slice(i, i + 5000))}`;
    }
    await tx`
      delete from popular_package where snapshot not in (
        select distinct snapshot from popular_package order by snapshot desc limit ${keep})`;
  });
}

export async function latestSnapshotDate(sql: Sql): Promise<string | null> {
  const [row] = await sql<{ s: string | null }[]>`select max(snapshot)::text as s from popular_package`;
  return row?.s ?? null;
}

export async function loadLatestSnapshot(sql: Sql): Promise<{ snapshot: string; names: PopularName[] } | null> {
  const snapshot = await latestSnapshotDate(sql);
  if (snapshot === null) return null;
  const rows = await sql<{ name: string; rank: number }[]>`
    select name, rank from popular_package where snapshot = ${snapshot} order by rank`;
  return { snapshot, names: rows.map((r) => ({ name: r.name, rank: r.rank })) };
}
