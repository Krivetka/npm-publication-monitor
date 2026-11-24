// Contract tests of the API documentation: the specification file in the repository is the one
// the server serves, it is well-formed OpenAPI 3.1, and every example in it — a real answer of
// the server, captured by scripts/api-examples.mjs — matches the schema it is attached to.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ERROR_EXAMPLES, EXAMPLES } from '../src/api/examples.ts';
import { openapi } from '../src/api/openapi.ts';

type Schema = Record<string, unknown>;
type Doc = {
  openapi: string;
  info: Record<string, unknown>;
  tags: { name: string; description?: string }[];
  security?: unknown[];
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema>; securitySchemes: Record<string, unknown> };
};
type Operation = {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Record<string, unknown>[];
  parameters?: { name: string; in: string; required?: boolean; schema?: Schema }[];
  requestBody?: { content: Record<string, { schema: Schema; example?: unknown }> };
  responses: Record<string, { description?: string; content?: Record<string, { schema: Schema; example?: unknown }> }>;
};
const doc = openapi as unknown as Doc;

// A validator for the part of JSON Schema that the document uses.
function validate(schema: Schema, value: unknown, path = '$'): string[] {
  if (typeof schema.$ref === 'string') {
    const name = /^#\/components\/schemas\/(\w+)$/.exec(schema.$ref)?.[1];
    const target = name ? doc.components.schemas[name] : undefined;
    return target ? validate(target, value, path) : [`${path}: unresolved ${schema.$ref}`];
  }
  const errors: string[] = [];
  if (Array.isArray(schema.allOf)) for (const s of schema.allOf as Schema[]) errors.push(...validate(s, value, path));
  if (Array.isArray(schema.oneOf)) {
    const ok = (schema.oneOf as Schema[]).filter((s) => validate(s, value, path).length === 0).length;
    if (ok === 0) errors.push(`${path}: matches no alternative of oneOf`);
  }
  const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (schema.type !== undefined) {
    const types = [schema.type].flat() as string[];
    const t = typeOf(value);
    if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) return [...errors, `${path}: is ${t}, expected ${types.join(' or ')}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} is not in the enum`);
  if (typeof value === 'string') {
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push(`${path}: not a date-time`);
    if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors.push(`${path}: not a date`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validate(schema.items as Schema, v, `${path}[${i}]`)));
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) if (!(key in obj)) errors.push(`${path}: missing ${key}`);
    const props = (schema.properties as Record<string, Schema> | undefined) ?? {};
    for (const [key, v] of Object.entries(obj)) {
      if (props[key]) errors.push(...validate(props[key], v, `${path}.${key}`));
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties as Schema, v, `${path}.${key}`));
    }
  }
  return errors;
}

const operations = Object.entries(doc.paths).flatMap(([path, item]) => Object.entries(item).map(([method, op]) => ({ path, method, op })));

describe('API specification file', () => {
  it('documentation/api/schemas/openapi.json is the document the server serves', () => {
    const file = readFileSync(new URL('../documentation/api/schemas/openapi.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(file, `${JSON.stringify(openapi, null, 2)}\n`, 'run `npm run api:spec`');
  });

  it('is well-formed OpenAPI 3.1', () => {
    assert.match(doc.openapi, /^3\.1\.\d+$/);
    for (const key of ['title', 'version', 'description', 'license', 'contact']) assert.ok(doc.info[key], `info.${key}`);
    assert.ok(!JSON.stringify(doc).includes('"nullable"'), '`nullable` is OpenAPI 3.0; 3.1 uses a union with "null"');
    const tags = new Set(doc.tags.map((t) => t.name));
    for (const t of doc.tags) assert.ok(t.description, `tag ${t.name} has no description`);
    const ids = new Set<string>();
    for (const { path, method, op } of operations) {
      const where = `${method.toUpperCase()} ${path}`;
      assert.ok(path.startsWith('/'), where);
      assert.ok(op.summary && op.description, `${where}: summary and description`);
      assert.ok(!ids.has(op.operationId), `${where}: duplicate operationId`);
      ids.add(op.operationId);
      for (const t of op.tags ?? []) assert.ok(tags.has(t), `${where}: undeclared tag ${t}`);
      assert.ok((op.tags ?? []).length > 0, `${where}: no tag`);
      // every {parameter} of the path is declared as a required path parameter
      for (const [, name] of path.matchAll(/\{(\w+)\}/g)) {
        const p = (op.parameters ?? []).find((x) => x.in === 'path' && x.name === name);
        assert.ok(p?.required && p.schema, `${where}: path parameter ${name}`);
      }
      for (const s of op.security ?? []) for (const scheme of Object.keys(s)) assert.ok(doc.components.securitySchemes[scheme], `${where}: unknown security scheme ${scheme}`);
      for (const [code, res] of Object.entries(op.responses)) {
        assert.match(code, /^[1-5]\d\d$/, where);
        assert.ok(res.description, `${where} ${code}: description`);
      }
    }
  });

  it('every $ref resolves', () => {
    JSON.stringify(doc, (k, v) => {
      if (k === '$ref') assert.ok(doc.components.schemas[String(v).replace('#/components/schemas/', '')], `unresolved ${v}`);
      return v;
    });
  });

  it('write operations require the analyst token and document 401', () => {
    for (const { path, method, op } of operations.filter((o) => o.method === 'put' || o.method === 'delete')) {
      assert.deepEqual(op.security, [{ analystToken: [] }], `${method} ${path}`);
      assert.ok(op.responses['401'], `${method} ${path}: 401`);
    }
    assert.deepEqual(doc.security, [], 'read operations need no credentials');
  });
});

describe('API examples', () => {
  it('every JSON response and every request body has an example', () => {
    for (const { path, method, op } of operations) {
      for (const [code, res] of Object.entries(op.responses)) {
        const media = res.content?.['application/json'];
        if (media) assert.notEqual(media.example, undefined, `${method.toUpperCase()} ${path} ${code}`);
      }
      const body = op.requestBody?.content['application/json'];
      if (op.requestBody) assert.notEqual(body?.example, undefined, `${method.toUpperCase()} ${path}: request body`);
    }
  });

  it('every example matches its schema', () => {
    for (const { path, method, op } of operations) {
      for (const [code, res] of Object.entries(op.responses)) {
        const media = res.content?.['application/json'];
        if (!media) continue;
        assert.deepEqual(validate(media.schema, media.example), [], `${method.toUpperCase()} ${path} ${code}`);
      }
      const body = op.requestBody?.content['application/json'];
      if (body) assert.deepEqual(validate(body.schema, body.example), [], `${method.toUpperCase()} ${path}: request body`);
    }
  });

  it('every operation has a captured answer, and error answers carry a message', () => {
    for (const { op } of operations) if (op.operationId !== 'deleteFinding') assert.ok(EXAMPLES[op.operationId], op.operationId);
    // deleteFinding answers 204 without a body: its example is a file written by hand
    assert.ok(existsSync(new URL('../documentation/api/examples/deleteFinding.md', import.meta.url)));
    assert.ok(ERROR_EXAMPLES.length >= 15);
    for (const e of ERROR_EXAMPLES) {
      assert.ok(e.status >= 400 && e.status < 500, `${e.operation}: ${e.status}`);
      assert.ok(typeof e.response.error === 'string' && e.response.error.length > 0, e.operation);
    }
  });

  it('examples hold no e-mail address and no account name', () => {
    const text = JSON.stringify({ EXAMPLES, ERROR_EXAMPLES });
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}"/.test(text.replace(/"@[a-z0-9-]+\/[^"]*"/g, '""')), 'an e-mail address');
    for (const m of text.matchAll(/"user:([^"]+)"/g)) assert.match(m[1]!, /^account-\d+$/, m[0]);
  });
});
