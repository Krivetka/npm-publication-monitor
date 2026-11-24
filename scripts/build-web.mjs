// Production build of the dashboard with esbuild.
//
//   node scripts/build-web.mjs [--analyse]
//
// Input: src/web/static/app.js and the modules it imports (Preact, htm, the pages).
// Output: src/web/static/dist/
//   app-<hash>.js       the entry: framework, shell, overview
//   <page>-<hash>.js    one chunk per lazily loaded page, shared code in its own chunks
//   styles-<hash>.css   the stylesheet, minified
//   index.html          the shell that refers to the files above
//   meta.json           sizes of every output, for the bundle report
//
// The server serves dist/index.html when it exists; without a build it serves the source
// modules through an import map, which is how the project runs in development.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const SRC = 'src/web/static';
const OUT = `${SRC}/dist`;
const BASE = '/npm/static/dist';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const result = await build({
  entryPoints: { app: `${SRC}/app.js` },
  bundle: true,
  format: 'esm',
  splitting: true,
  minify: true,
  sourcemap: true,
  target: ['es2022'],
  outdir: OUT,
  entryNames: '[name]-[hash]',
  chunkNames: '[name]-[hash]',
  metafile: true,
  legalComments: 'none',
  logLevel: 'warning',
});

// the stylesheet: minified by the same tool, named by its content
const css = await build({ entryPoints: [`${SRC}/styles.css`], minify: true, write: false, outdir: OUT, logLevel: 'warning' });
const cssText = css.outputFiles[0].text;
const cssName = `styles-${createHash('sha256').update(cssText).digest('hex').slice(0, 8).toUpperCase()}.css`;
writeFileSync(`${OUT}/${cssName}`, cssText);

const outputs = Object.entries(result.metafile.outputs).filter(([f]) => f.endsWith('.js'));
const entryPath = outputs.find(([, o]) => o.entryPoint === `${SRC}/app.js`)?.[0];
if (!entryPath) throw new Error('the build has no entry chunk');
const entry = entryPath.split('/').pop();

// the shell: no import map, one module script, the hashed stylesheet
let shell = readFileSync(`${SRC}/index.html`, 'utf8');
shell = shell.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
shell = shell.replace('<link rel="stylesheet" href="/npm/static/styles.css">', `<link rel="stylesheet" href="${BASE}/${cssName}">\n<link rel="modulepreload" href="${BASE}/${entry}">`);
shell = shell.replace('<script type="module" src="/npm/static/app.js"></script>', `<script type="module" src="${BASE}/${entry}"></script>`);
if (shell.includes('importmap') || !shell.includes(entry) || !shell.includes(cssName)) throw new Error('index.html was not rewritten: its markup changed');
writeFileSync(`${OUT}/index.html`, shell);

// the report: the entry and what it imports statically are the first load; a page chunk is
// fetched when its route is opened
const sizeOf = (file) => { const buf = readFileSync(file); return { bytes: buf.length, gzip: gzipSync(buf).length }; };
const eager = new Set();
const visit = (file) => {
  if (eager.has(file)) return;
  eager.add(file);
  for (const i of result.metafile.outputs[file].imports) if (i.kind === 'import-statement') visit(i.path);
};
visit(entryPath);
const kindOf = (f, o) => (f === entryPath ? 'entry' : eager.has(f) ? 'shared' : o.entryPoint ? 'page' : 'lazy');
const ORDER = { entry: 0, shared: 1, page: 2, lazy: 3, style: 4 };
const files = [...outputs.map(([f, o]) => ({ file: f.split('/').pop(), kind: kindOf(f, o), ...sizeOf(f), modules: Object.keys(o.inputs).length })), { file: cssName, kind: 'style', ...sizeOf(`${OUT}/${cssName}`), modules: 1 }]
  .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.bytes - a.bytes);
const sum = (list) => list.reduce((s, f) => ({ bytes: s.bytes + f.bytes, gzip: s.gzip + f.gzip }), { bytes: 0, gzip: 0 });
const total = sum(files);
const firstLoad = sum(files.filter((f) => ['entry', 'shared', 'style'].includes(f.kind)));
writeFileSync(`${OUT}/meta.json`, `${JSON.stringify({ entry, style: cssName, files, total, firstLoad }, null, 1)}
`);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log('File'.padEnd(34), 'Kind'.padEnd(6), 'Size'.padStart(9), 'Gzip'.padStart(9), 'Modules'.padStart(8));
for (const f of files) console.log(f.file.padEnd(34), f.kind.padEnd(6), kb(f.bytes).padStart(9), kb(f.gzip).padStart(9), String(f.modules).padStart(8));
console.log(`\nfirst load (entry, its static imports, stylesheet): ${kb(firstLoad.bytes)}, ${kb(firstLoad.gzip)} gzip`);
console.log(`everything: ${kb(total.bytes)}, ${kb(total.gzip)} gzip in ${files.length} files`);

if (process.argv.includes('--analyse')) {
  const { analyzeMetafile } = await import('esbuild');
  console.log(await analyzeMetafile(result.metafile, { verbose: false }));
}
