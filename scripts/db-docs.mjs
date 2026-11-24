// Generates the database documents from the catalogue of a migrated database:
//
//   documentation/database/data-dictionary.md   tables, columns, keys, constraints, indexes,
//                                               triggers, views, functions (text from COMMENT ON)
//   documentation/database/logical-schema.svg   logical schema with every column, colour = block
//   documentation/docs/assets/diagrams/er.svg   the same schema with key columns, for the thesis page
//
//   node --env-file-if-exists=.env scripts/db-docs.mjs      (npm run db:docs)
//
// The consolidated DDL script next to them is a plain pg_dump:
//   pg_dump --schema-only --no-owner --no-privileges "$DATABASE_URL_ADMIN" > documentation/database/schema.sql

import { mkdir, writeFile } from 'node:fs/promises';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const sql = postgres(url, { max: 2, onnotice: () => {} });
const out = new URL('../documentation/database/', import.meta.url);

// Blocks of the logical schema: order of the dictionary and colours of the diagram.
const BLOCKS = [
  { id: 'raw', title: 'Raw layer: journal and inputs', color: '#2A78D6', tables: ['feed_event', 'collector_state', 'popular_package'] },
  { id: 'ref', title: 'Reference data', color: '#B7791F', tables: ['source', 'feature'] },
  { id: 'proc', title: 'Processing layer: stage results', color: '#2F855A', tables: ['stage_cursor', 'stage1_result', 'stage2_result', 'maintainer_set', 'rdap_cache'] },
  { id: 'mart', title: 'Mart layer: counters and totals', color: '#0E7490', tables: ['stage1_hourly', 'source_usage', 'daily_stats'] },
  { id: 'analyst', title: 'Analyst layer: verdicts', color: '#C2410C', tables: ['finding', 'finding_history'] },
  { id: 'ops', title: 'Privacy and operations', color: '#6B46C1', tables: ['exclusion', 'retention_run', 'schema_migrations'] },
];
const blockOf = (t) => BLOCKS.find((b) => b.tables.includes(t));

const short = (t) =>
  t.replace('timestamp with time zone', 'timestamptz').replace('character varying', 'varchar').replace('double precision', 'float8');

const relations = await sql`
  select c.oid, c.relname as name, c.relkind as kind, obj_description(c.oid, 'pg_class') as comment,
         pg_get_partkeydef(c.oid) as partkey
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and not c.relispartition
  order by c.relname`;
const columns = await sql`
  select a.attrelid as oid, a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull,
         pg_get_expr(d.adbin, d.adrelid) as def, a.attidentity as identity, col_description(a.attrelid, a.attnum) as comment, a.attnum as num
  from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped
  order by a.attrelid, a.attnum`;
const constraints = await sql`
  select conrelid as oid, conname as name, contype as type, pg_get_constraintdef(oid) as def, conkey as cols,
         confrelid::regclass::text as target
  from pg_constraint where connamespace = 'public'::regnamespace and conrelid <> 0 and contype in ('p', 'f', 'u', 'c')
  order by conrelid, contype, conname`;
const indexes = await sql`
  select c.oid, i.indexname as name, i.indexdef as def
  from pg_indexes i join pg_class c on c.relname = i.tablename and c.relnamespace = 'public'::regnamespace
  where i.schemaname = 'public' order by i.tablename, i.indexname`;
const triggers = await sql`
  select tgrelid as oid, tgname as name, pg_get_triggerdef(oid) as def
  from pg_trigger where not tgisinternal order by tgrelid, tgname`;
const functions = await sql`
  select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result,
         p.prosecdef as definer, l.lanname as lang, obj_description(p.oid, 'pg_proc') as comment
  from pg_proc p join pg_language l on l.oid = p.prolang
  where p.pronamespace = 'public'::regnamespace order by p.proname`;

const byName = new Map(relations.map((r) => [r.name, r]));
const colsOf = (oid) => columns.filter((c) => c.oid === oid);
const consOf = (oid) => constraints.filter((c) => c.oid === oid);
const keyMarks = (rel, col) => {
  const marks = [];
  for (const c of consOf(rel.oid)) {
    if (!c.cols.includes(col.num)) continue;
    if (c.type === 'p') marks.push('PK');
    if (c.type === 'f') marks.push(`FK → ${c.target}`);
    if (c.type === 'u') marks.push('UQ');
  }
  return [...new Set(marks)];
};

// ── Data dictionary ───────────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const md = [];
md.push('# Data dictionary');
md.push('');
md.push('Generated from the database catalogue by `scripts/db-docs.mjs`; the descriptions are the `COMMENT ON` texts of migration `011_comments.sql`. Do not edit by hand.');
md.push('');
md.push('Notation: **PK** primary key, **FK → t** foreign key to table *t*, **UQ** unique. A column is NOT NULL unless the column "Null" says *yes*. The monthly partitions of `feed_event` (`feed_event_YYYYMM`, `feed_event_default`) have the columns of the parent and are not listed.');
md.push('');
const tableCount = relations.filter((r) => r.kind === 'r' || r.kind === 'p').length;
md.push(`The schema has ${tableCount} tables, ${relations.filter((r) => r.kind === 'v').length} views, ${relations.filter((r) => r.kind === 'm').length} materialised view, ${functions.length} functions and ${triggers.length} triggers.`);
md.push('');

for (const b of BLOCKS) {
  md.push(`## ${b.title}`);
  md.push('');
  for (const t of b.tables) {
    const rel = byName.get(t);
    if (!rel) throw new Error(`table ${t} is not in the database`);
    const kind = rel.kind === 'm' ? 'materialised view' : rel.kind === 'p' ? `table, partitioned by ${rel.partkey}` : 'table';
    md.push(`### ${t}`);
    md.push('');
    md.push(`*${kind}.* ${rel.comment ?? ''}`);
    md.push('');
    md.push('| Column | Type | Null | Key | Description |');
    md.push('|---|---|---|---|---|');
    for (const c of colsOf(rel.oid)) {
      const def = c.identity ? 'identity' : c.def;
      const type = short(c.type) + (def ? `, default \`${esc(def)}\`` : '');
      md.push(`| \`${c.name}\` | ${type} | ${c.notnull ? '' : 'yes'} | ${keyMarks(rel, c).join(', ')} | ${esc(c.comment)} |`);
    }
    md.push('');
    const cons = consOf(rel.oid).filter((c) => c.type !== 'p' || c.cols.length > 1);
    if (cons.length > 0) {
      md.push('Constraints:');
      md.push('');
      for (const c of cons) md.push(`- \`${c.name}\`: \`${esc(c.def)}\``);
      md.push('');
    }
    const idx = indexes.filter((i) => i.oid === rel.oid && !constraints.some((c) => c.name === i.name));
    if (idx.length > 0) {
      md.push('Indexes (besides the keys):');
      md.push('');
      for (const i of idx) md.push(`- \`${i.name}\`: \`${esc(i.def.replace(/^CREATE (UNIQUE )?INDEX \S+ ON (ONLY )?public\./, (m, u) => (u ? 'UNIQUE ' : '')))}\``);
      md.push('');
    }
    const trg = triggers.filter((x) => x.oid === rel.oid);
    if (trg.length > 0) {
      md.push('Triggers:');
      md.push('');
      for (const x of trg) md.push(`- \`${x.name}\`: ${esc(x.def.replace(/^CREATE TRIGGER \S+ /, '').replace(/ ON public\.\S+/, '').replace('EXECUTE FUNCTION ', '→ `') + '`')}`);
      md.push('');
    }
  }
}

md.push('## Views');
md.push('');
for (const v of relations.filter((r) => r.kind === 'v')) {
  md.push(`### ${v.name}`);
  md.push('');
  md.push(v.comment ?? '');
  md.push('');
  md.push(`Columns: ${colsOf(v.oid).map((c) => `\`${c.name}\` ${short(c.type)}`).join(', ')}.`);
  md.push('');
}

md.push('## Functions');
md.push('');
md.push('| Function | Returns | Rights | Description |');
md.push('|---|---|---|---|');
for (const f of functions) {
  md.push(`| \`${f.name}(${esc(short(f.args))})\` | ${esc(short(f.result))} | ${f.definer ? 'owner (SECURITY DEFINER)' : 'caller'} | ${esc(f.comment)} |`);
}
md.push('');

await mkdir(out, { recursive: true });
await writeFile(new URL('data-dictionary.md', out), md.join('\n'));

// ── Logical schema (SVG) ──────────────────────────────────────────────────────────────────
//
// Two renderings of the same catalogue data: the full schema with every column, and a compact
// one with the key columns for the thesis page (docs/assets/diagrams/er.svg).

const HEAD = 28;
const ROW = 18;
const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const FULL = {
  width: 1610,
  title: 'Logical schema of the npm-monitor database (PostgreSQL 18)',
  views: true,
  layout: {
    collector_state: [40, 100, 250], feed_event: [340, 100, 290], feature: [680, 100, 300], source: [1030, 100, 250], popular_package: [1320, 100, 250],
    source_usage: [1030, 222, 250],
    finding: [40, 390, 250], stage1_result: [340, 390, 290], stage2_result: [680, 390, 300], maintainer_set: [1030, 390, 250], rdap_cache: [1320, 390, 250],
    finding_history: [40, 570, 250], exclusion: [1320, 560, 250],
    stage_cursor: [40, 790, 250], stage1_hourly: [340, 790, 290], daily_stats: [680, 790, 300], retention_run: [1030, 790, 250], schema_migrations: [1320, 790, 250],
  },
};

const COMPACT = {
  width: 1240,
  title: null,
  views: false,
  layout: {
    collector_state: [20, 50, 195], feed_event: [260, 50, 215], feature: [520, 50, 230], source: [795, 50, 195], popular_package: [1035, 50, 185],
    source_usage: [795, 140, 195],
    finding: [20, 285, 195], stage1_result: [260, 285, 215], stage2_result: [520, 285, 230], maintainer_set: [795, 285, 195], rdap_cache: [1035, 285, 185],
    finding_history: [20, 420, 195], exclusion: [1035, 400, 185],
    stage_cursor: [20, 590, 195], stage1_hourly: [260, 590, 215], daily_stats: [520, 590, 230], retention_run: [795, 590, 195], schema_migrations: [1035, 590, 185],
  },
  columns: {
    feed_event: ['seq', 'package', 'rev', 'observed_at'], collector_state: ['feed', 'last_seq'], popular_package: ['snapshot', 'name', 'rank'],
    feature: ['id', 'stage', 'weight'], source: ['id'], source_usage: ['hour', 'source', 'requests'],
    finding: ['seq', 'observed_at', 'verdict'], finding_history: ['id', 'seq', 'operation', 'verdict'],
    stage1_result: ['seq', 'event_time', 'prescore', 'candidate', 'features'],
    stage2_result: ['seq', 'event_time', 'final_score', 'alert', 'features', 'evidence'],
    maintainer_set: ['package', 'seq', 'maintainers'], rdap_cache: ['domain', 'registered'], exclusion: ['account'],
    stage_cursor: ['stage', 'last_seq'], stage1_hourly: ['hour', 'processed'], daily_stats: ['day', 'alerts'],
    retention_run: ['ran_at', 'snapshots_purged'], schema_migrations: ['name'],
  },
};

function render(cfg) {
  const svg = [];
  const box = {};
  const body = [];

  for (const [t, [bx, by, bw]] of Object.entries(cfg.layout)) {
    const rel = byName.get(t);
    const all = colsOf(rel.oid);
    const cols = cfg.columns ? all.filter((c) => cfg.columns[t].includes(c.name)) : all;
    const more = all.length - cols.length;
    const bh = HEAD + (cols.length + (more > 0 ? 1 : 0)) * ROW + 8;
    box[t] = { x: bx, y: by, w: bw, h: bh };
    const color = blockOf(t).color;
    const note = rel.kind === 'p' ? ' (partitioned by month)' : rel.kind === 'm' ? ' (materialised view)' : '';
    body.push(`<g><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="6" fill="#FFFFFF" stroke="${color}" stroke-width="1.6"/>`);
    body.push(`<path d="M${bx},${by + HEAD} V${by + 6} a6,6 0 0 1 6,-6 H${bx + bw - 6} a6,6 0 0 1 6,6 V${by + HEAD} Z" fill="${color}"/>`);
    body.push(`<text x="${bx + 10}" y="${by + 19}" font-size="14" font-weight="700" fill="#FFFFFF">${x(t)}<tspan font-weight="400" font-size="11">${x(cfg.columns && rel.kind === 'p' ? ' (partitioned)' : cfg.columns && rel.kind === 'm' ? ' (mat. view)' : note)}</tspan></text>`);
    cols.forEach((c, i) => {
      const marks = keyMarks(rel, c);
      const pk = marks.includes('PK');
      const fk = marks.some((m) => m.startsWith('FK'));
      const yy = by + HEAD + 15 + i * ROW;
      body.push(`<text x="${bx + 10}" y="${yy}" font-size="12.5" fill="#17181C"${pk ? ' font-weight="700"' : ''}>${x(c.name)}</text>`);
      const tag = [fk ? 'FK' : '', c.notnull ? '' : 'null'].filter(Boolean).join(' · ');
      body.push(`<text x="${bx + bw - 10}" y="${yy}" font-size="11.5" fill="#6B7280" text-anchor="end">${x(short(c.type))}${tag ? ` · ${tag}` : ''}</text>`);
    });
    if (more > 0) body.push(`<text x="${bx + 10}" y="${by + HEAD + 15 + cols.length * ROW}" font-size="11.5" fill="#6B7280" font-style="italic">+ ${more} more</text>`);
    body.push('</g>');
  }

  const b = (t) => box[t];
  const top = (t) => b(t).y;
  const bottom = (t) => b(t).y + b(t).h;
  const left = (t) => b(t).x;
  const right = (t) => b(t).x + b(t).w;
  const cx = (t) => b(t).x + b(t).w / 2;
  const line = (d, label, lx, ly, dashed = false, anchor = 'start') => {
    body.push(`<path d="${d}" fill="none" stroke="${dashed ? '#6B46C1' : '#17181C'}" stroke-width="1.6"${dashed ? ' stroke-dasharray="6 4" marker-end="url(#arrow)"' : ''}/>`);
    if (!label) return;
    label.split('\n').forEach((l, i) =>
      body.push(`<text x="${lx}" y="${ly + i * 14}" font-size="11.5" fill="${dashed ? '#6B46C1' : '#17181C'}" text-anchor="${anchor}" paint-order="stroke" stroke="#FFFFFF" stroke-width="4">${x(l)}</text>`));
  };

  // foreign keys
  line(`M${cx('stage1_result')},${bottom('feed_event')} V${top('stage1_result')}`, '1 : 0..1\n(seq, event_time)', cx('stage1_result') - 8, top('stage1_result') - 30, false, 'end');
  const rowY = top('stage1_result') + 50;
  line(`M${right('stage1_result')},${rowY} H${left('stage2_result')}`, '1 : 0..1', (right('stage1_result') + left('stage2_result')) / 2, rowY - 8, false, 'middle');
  line(`M${right('stage2_result')},${rowY} H${left('maintainer_set')}`, '1 : 0..N', (right('stage2_result') + left('maintainer_set')) / 2, rowY - 8, false, 'middle');
  const bendY = top('finding') - 60;
  line(`M${left('feed_event') + 20},${bottom('feed_event')} V${bendY} H${cx('finding')} V${top('finding')}`, '1 : 0..1  (seq, observed_at)', cx('finding') + 10, bendY - 8);
  line(`M${cx('source')},${bottom('source')} V${top('source_usage')}`, '1 : N', cx('source') + 8, bottom('source') + 13);
  // rules kept by triggers
  line(`M${cx('feature')},${bottom('feature')} V${top('stage2_result') - 2}`, 'feature ids of\nthe JSON lists', cx('feature') + 8, bottom('feature') + 30, true);
  line(`M${left('feature') + 20},${bottom('feature')} V${top('stage1_result') - 40} H${right('stage1_result') - 70} V${top('stage1_result') - 2}`, '', 0, 0, true);
  line(`M${cx('finding')},${bottom('finding')} V${top('finding_history') - 2}`, 'audit', cx('finding') + 8, bottom('finding') + 17, true);
  const redY = Math.min(top('exclusion') + 40, bottom('stage2_result') - 20);
  line(`M${left('exclusion')},${redY} H${cx('maintainer_set')} V${bottom('maintainer_set') + 2}`, 'redaction', cx('maintainer_set') + 22, redY - 8, true);
  line(`M${cx('maintainer_set')},${redY} H${right('stage2_result') + 2}`, '', 0, 0, true);

  let y = Math.max(...Object.keys(box).map(bottom)) + 24;
  if (cfg.views) {
    body.push(`<rect x="40" y="${y}" width="${cfg.width - 80}" height="124" rx="6" fill="#F7F7F5" stroke="#9CA3AF" stroke-width="1.2" stroke-dasharray="5 4"/>`);
    body.push(`<text x="52" y="${y + 22}" font-size="14" font-weight="700" fill="#17181C">Views</text>`);
    const views = [
      ['feature_hit', 'one row per fired feature (relational form of the JSON lists)'],
      ['maintainer_change', 'one row per added or removed account (relational form of the arrays)'],
      ['alert', 'alerts with scores and the current verdict'],
      ['stage2_result_masked', 'stage 2 without snapshots and feature values'],
      ['maintainer_set_masked', 'maintainer history with pseudonyms'],
      ['data_quality', 'expectations of the data dictionary with the number of violations'],
    ];
    views.forEach(([n, d], i) => {
      body.push(`<text x="${52 + (i % 2) * 770}" y="${y + 46 + Math.floor(i / 2) * 26}" font-size="12.5" fill="#17181C"><tspan font-weight="700">${x(n)}</tspan> — ${x(d)}</text>`);
    });
    y += 148;
  }

  // legend
  let lx = left('collector_state');
  for (const blk of BLOCKS) {
    const label = cfg.columns ? blk.title.replace(/:.*/, '') : blk.title;
    body.push(`<rect x="${lx}" y="${y}" width="16" height="16" rx="3" fill="${blk.color}"/>`);
    body.push(`<text x="${lx + 22}" y="${y + 13}" font-size="12.5" fill="#17181C">${x(label)}</text>`);
    lx += 40 + label.length * 6.9;
  }
  if (cfg.columns) {
    y += 26;
    body.push(`<text x="${left('collector_state')}" y="${y + 12}" font-size="12" fill="#4A4D55">Bold = primary key, FK = foreign key column. Solid line = foreign key; dashed line = rule kept by a trigger.</text>`);
  }
  const height = y + 36;

  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cfg.width} ${height}" width="${cfg.width}" height="${height}" font-family="Arial, Helvetica, sans-serif">`);
  svg.push('<title>npm-monitor: logical database schema</title>');
  svg.push(`<rect width="${cfg.width}" height="${height}" fill="#FFFFFF"/>`);
  svg.push('<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M1,1 L9,5 L1,9" stroke="#6B46C1" stroke-width="1.4" fill="none"/></marker></defs>');
  if (cfg.title) {
    svg.push(`<text x="40" y="44" font-size="24" font-weight="700" fill="#17181C">${x(cfg.title)}</text>`);
    svg.push('<text x="40" y="70" font-size="14" fill="#4A4D55">Colour of the header = block. Bold = primary key. FK = foreign key column. Solid line = foreign key, dashed line = rule kept by a trigger.</text>');
  }
  svg.push(...body, '</svg>');
  return svg.join('\n');
}

await writeFile(new URL('logical-schema.svg', out), render(FULL));
await writeFile(new URL('../docs/assets/diagrams/er.svg', out), render(COMPACT));

await sql.end();
console.log(`data-dictionary.md: ${md.length} lines; logical-schema.svg and er.svg: ${Object.keys(FULL.layout).length} tables`);
