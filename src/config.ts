// Configuration from environment variables. Locally .env is loaded by
// `node --env-file-if-exists=.env`; in docker compose via the environment section.

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`environment variable ${name} is not set`);
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${name}: expected a non-negative integer, got "${raw}"`);
  return v;
}

function optionalInt(name: string): number | null {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? null : int(name, 0);
}

export function loadConfig() {
  return {
    // Three database roles (deploy/db-roles.sql). DATABASE_URL is the pipeline role; the other
    // two fall back to it, so a single-role development setup needs one variable only.
    databaseUrl: str('DATABASE_URL'),
    databaseAdminUrl: str('DATABASE_URL_ADMIN', str('DATABASE_URL')),
    databaseWebUrl: str('DATABASE_URL_WEB', str('DATABASE_URL')),
    maintenance: {
      intervalMs: int('MAINTENANCE_INTERVAL_MS', 86_400_000),
      // retention period of the privacy notice in days; 0 switches the snapshot clean-up off
      evidenceDays: int('RETENTION_EVIDENCE_DAYS', 30),
      // ISO date after which alerts, their snapshots and verdicts are removed; unset — never
      deleteAllAfter: process.env.RETENTION_DELETE_ALL_AFTER || null,
    },
    feed: {
      url: str('FEED_URL', 'https://replicate.npmjs.com/registry').replace(/\/+$/, ''),
      startSeq: optionalInt('FEED_START_SEQ'),
      batchLimit: int('FEED_BATCH_LIMIT', 1000),
      pollIntervalMs: int('FEED_POLL_INTERVAL_MS', 5000),
      requestTimeoutMs: int('FEED_REQUEST_TIMEOUT_MS', 30000),
      headCheckIntervalMs: int('FEED_HEAD_CHECK_INTERVAL_MS', 60000),
    },
    popular: {
      size: int('POPULAR_SIZE', 10000),
      checkIntervalMs: int('POPULAR_CHECK_INTERVAL_MS', 3_600_000),
      requestTimeoutMs: int('POPULAR_REQUEST_TIMEOUT_MS', 120_000),
    },
    stage1: {
      batchLimit: int('STAGE1_BATCH_LIMIT', 1000),
      pollIntervalMs: int('STAGE1_POLL_INTERVAL_MS', 2000),
      popularReloadMs: int('STAGE1_POPULAR_RELOAD_MS', 600_000),
    },
    web: {
      host: str('WEB_HOST', '127.0.0.1'),
      port: int('WEB_PORT', 8090),
      basePath: str('WEB_BASE_PATH', '/npm').replace(/\/+$/, ''),
      // bearer token for the one write endpoint (analyst verdicts); unset — writes are refused
      analystToken: process.env.ANALYST_TOKEN || null,
    },
    stage2: {
      githubToken: process.env.GITHUB_TOKEN || null,
      pollIntervalMs: int('STAGE2_POLL_INTERVAL_MS', 5000),
      requestTimeoutMs: int('STAGE2_REQUEST_TIMEOUT_MS', 60_000),
      // requests per hour per source; GitHub without a token allows 60/h, keep a margin
      perHour: {
        registry: int('STAGE2_REGISTRY_PER_HOUR', 3000),
        ecosystems: int('STAGE2_ECOSYSTEMS_PER_HOUR', 2000),
        depsdev: int('STAGE2_DEPSDEV_PER_HOUR', 1000),
        github: int('STAGE2_GITHUB_PER_HOUR', process.env.GITHUB_TOKEN ? 4000 : 50),
        rdap: int('STAGE2_RDAP_PER_HOUR', 200),
      },
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
