import type { Sql } from '../db.ts';

export interface MaintenanceConfig {
  evidenceDays: number;
  deleteAllAfter: string | null;
}

export interface MaintenanceReport {
  partitions: string[];
  retention: { snapshots: number; maintainerRows: number; alerts: number; findings: number } | null;
}

// One maintenance pass. Every step is a database function, so the same rules apply when an
// operator runs them by hand.
export async function runMaintenance(sql: Sql, cfg: MaintenanceConfig): Promise<MaintenanceReport> {
  const [p] = await sql<{ created: string[] }[]>`select feed_event_ensure_partitions() as created`;
  let retention: MaintenanceReport['retention'] = null;
  if (cfg.evidenceDays > 0) {
    const [r] = await sql<{ snapshots_purged: number; maintainer_rows_purged: number; alerts_purged: number; findings_purged: number }[]>`
      select * from apply_retention(${cfg.evidenceDays}, ${cfg.deleteAllAfter}::timestamptz)`;
    retention = { snapshots: r!.snapshots_purged, maintainerRows: r!.maintainer_rows_purged, alerts: r!.alerts_purged, findings: r!.findings_purged };
  }
  await sql`select refresh_daily_stats()`;
  return { partitions: p?.created ?? [], retention };
}
