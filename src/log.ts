// Structured log: one JSON line per record on stdout (docker logs).

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
type Fields = Record<string, unknown>;

const threshold = LEVELS[(process.env.LOG_LEVEL ?? 'info') as Level] ?? LEVELS.info;

function write(level: Level, msg: string, fields?: Fields): void {
  if (LEVELS[level] < threshold) return;
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }) + '\n');
}

export const log = {
  debug: (msg: string, fields?: Fields) => write('debug', msg, fields),
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};

export function errFields(e: unknown): Fields {
  if (e instanceof Error) {
    const cause = e.cause instanceof Error ? e.cause.message : undefined;
    return { err: e.message, errName: e.name, ...(cause ? { cause } : {}) };
  }
  return { err: String(e) };
}
