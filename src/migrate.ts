// Entry point of the migration service: runs as the owner role before any other process starts.

import { loadConfig } from './config.ts';
import { connect } from './db.ts';
import { runMigrations } from './db/migrate.ts';
import { errFields, log } from './log.ts';

const sql = connect(loadConfig().databaseAdminUrl, 'migrate');

try {
  const report = await runMigrations(sql, (name) => log.info('migration applied', { name }));
  log.info('migrations up to date', { total: report.total });
  log.info('reference data and access rights applied', { ...report.reference, roles: report.roles });
} catch (e) {
  log.error('migration failed', errFields(e));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
