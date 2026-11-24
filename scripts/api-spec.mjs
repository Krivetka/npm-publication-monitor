// Writes the OpenAPI document of the server to documentation/api/schemas/openapi.json, the
// version-controlled copy that tools and readers use. The source of truth is src/api/openapi.ts;
// test/api-contract.test.ts fails when the file is out of date.
//
//   node scripts/api-spec.mjs            write the file
//   node scripts/api-spec.mjs --check    exit 1 when the file differs from the code

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { openapi } from '../src/api/openapi.ts';

const FILE = new URL('../documentation/api/schemas/openapi.json', import.meta.url);
const text = `${JSON.stringify(openapi, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const same = existsSync(FILE) && readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n') === text;
  console.log(same ? 'openapi.json is up to date' : 'openapi.json differs from src/api/openapi.ts: run `npm run api:spec`');
  process.exit(same ? 0 : 1);
}
mkdirSync(new URL('.', FILE), { recursive: true });
writeFileSync(FILE, text);
const operations = Object.values(openapi.paths).reduce((n, item) => n + Object.keys(item).length, 0);
console.log(`documentation/api/schemas/openapi.json: ${operations} operations, ${Object.keys(openapi.components.schemas).length} schemas, ${text.length} bytes`);
