// Loads db/seed/test-data.sql into a migrated database, as one transaction: either all rows
// are stored or none. `npm run db:seed` — for a local demonstration and for the integration tests.

import { readFile } from 'node:fs/promises';
import type { Sql } from '../db.ts';

export async function loadSeed(sql: Sql): Promise<void> {
  const text = await readFile(new URL('../../db/seed/test-data.sql', import.meta.url), 'utf8');
  await sql.begin(async (tx) => {
    await tx.unsafe(text).simple();
  });
}

if (import.meta.main) {
  const { loadConfig } = await import('../config.ts');
  const { connect } = await import('../db.ts');
  const sql = connect(loadConfig().databaseAdminUrl, 'seed');
  try {
    await loadSeed(sql);
    console.log('test data loaded');
  } finally {
    await sql.end({ timeout: 5 });
  }
}
