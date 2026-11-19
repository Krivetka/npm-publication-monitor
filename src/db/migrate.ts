// Applies migrations/*.sql in file-name order; each migration runs in its own transaction
// together with its row in schema_migrations, so a failed migration leaves no trace.
// After the migrations the reference data and the access rights are brought up to date.

import { readdir, readFile } from 'node:fs/promises';
import type { Sql } from '../db.ts';
import { type ReferenceSync, syncReference } from './reference.ts';

const dir = new URL('../../migrations/', import.meta.url);

export interface MigrationReport {
  applied: string[];
  total: number;
  reference: ReferenceSync;
  roles: string[];
}

export async function runMigrations(sql: Sql, onApplied: (name: string) => void = () => {}): Promise<MigrationReport> {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const name of files) {
    if (done.has(name)) continue;
    const text = await readFile(new URL(name, dir), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text).simple();
      await tx`insert into schema_migrations (name) values (${name})`;
    });
    applied.push(name);
    onApplied(name);
  }

  // Reference data follows the code; access rights follow the schema. Both run on every start,
  // so a new feature or a new table needs no manual step.
  const reference = await syncReference(sql);
  const [grants] = await sql<{ roles: string[] }[]>`select grant_app_privileges() as roles`;
  return { applied, total: files.length, reference, roles: grants?.roles ?? [] };
}
