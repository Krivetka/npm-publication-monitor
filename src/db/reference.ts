// Fills the reference table `feature` from the code catalogue. The engines define which
// features exist and what they weigh; the table lets the database check stored results
// against that list (trigger features_check) and lets SQL reports join on it.
// `npm run db:reference` runs it alone; the migration runner calls it after every run.

import { featureCatalogue } from '../api/catalogue.ts';
import type { Sql } from '../db.ts';

export interface ReferenceSync {
  features: number;
  retired: number;
}

export async function syncReference(sql: Sql): Promise<ReferenceSync> {
  const rows = featureCatalogue().map((f) => ({
    id: f.id,
    stage: f.stage,
    lane: f.lane,
    weight: f.weight,
    title: f.title,
    hint: f.hint,
  }));
  return sql.begin(async (tx) => {
    await tx`
      insert into feature ${tx(rows)}
      on conflict (id) do update set
        stage = excluded.stage, lane = excluded.lane, weight = excluded.weight,
        title = excluded.title, hint = excluded.hint, active = true, updated_at = now()
      where (feature.stage, feature.lane, feature.weight, feature.title, feature.hint, feature.active)
            is distinct from (excluded.stage, excluded.lane, excluded.weight, excluded.title, excluded.hint, true)`;
    // A feature that the engines no longer emit stays as a retired row: stored results refer to it.
    const retired = await tx`
      update feature set active = false, updated_at = now()
      where active and id not in ${tx(rows.map((r) => r.id))}`;
    return { features: rows.length, retired: retired.count };
  });
}

if (import.meta.main) {
  const { loadConfig } = await import('../config.ts');
  const { connect } = await import('../db.ts');
  const sql = connect(loadConfig().databaseAdminUrl, 'reference');
  try {
    console.log(await syncReference(sql));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
