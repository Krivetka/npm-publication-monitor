import postgres from 'postgres';

export type Sql = postgres.Sql;

export function connect(url: string, appName: string): Sql {
  return postgres(url, {
    max: 4,
    onnotice: () => {},
    connection: { application_name: appName },
  });
}
