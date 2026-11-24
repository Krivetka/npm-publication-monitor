// Builds the thesis PDF (пояснительная записка of a bachelor project) from the Markdown
// template in documentation/docs/, formatted per "Правила оформления письменных работ в ЕГУ"
// (2025): title page per Appendix 1.4, abstract, contents with page numbers, unnumbered
// INTRODUCTION / CONCLUSIONS / REFERENCES, numbered chapters and subsections, "Fig. N.k" and
// "Table N.k" numbered within chapters, page numbers top right (none on the title page),
// Times New Roman 12 pt, 1.5 spacing, margins 25/10/20/20 mm. The declaration is a separate PDF.
//
// Pipeline: Markdown → HTML (marked) → PDF (headless Edge/Chrome) → page numbers found with
// pdf.js → final HTML with a filled contents → PDF → page numbers stamped with pdf-lib.
// Usage: node documentation/build.mjs [--html-only]
// Env: THESIS_PDF (default Documentation.pdf), DECLARATION_PDF (default Declaration.pdf)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, 'docs');
const out = join(here, 'build');
const htmlOnly = process.argv.includes('--html-only');
const meta = JSON.parse(readFileSync(join(here, 'meta.json'), 'utf8'));
const css = readFileSync(join(here, 'thesis.css'), 'utf8');
mkdirSync(out, { recursive: true });

// ── Chapters: the template folders in order; index.md gives the chapter title ──────────
const CHAPTERS = [
  { dir: '01-project-overview', files: ['index.md', 'problem-and-goals.md', 'stakeholders.md', 'scope.md', 'features.md'] },
  { dir: '02-technical', files: ['index.md', 'tech-stack.md', 'criteria/*.md', 'deployment.md'] },
  { dir: '03-user-guide', files: ['index.md', 'features.md', 'faq.md'] },
  { dir: '04-retrospective', files: ['index.md'] },
];
const BUDGET = { '01-project-overview': [8000, 12000], '02-technical': [15000, 25000], '03-user-guide': [5000, 8000], '04-retrospective': [3000, 5000] };

function expand(dir, pattern) {
  if (!pattern.endsWith('*.md')) return existsSync(join(docs, dir, pattern)) ? [pattern] : [];
  const sub = join(docs, dir, dirname(pattern));
  if (!existsSync(sub)) return [];
  return readdirSync(sub).filter((f) => f.endsWith('.md')).sort().map((f) => `${dirname(pattern)}/${f}`);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const strip = (s) => s.replace(/<[^>]+>/g, '');
const slug = (s) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function renderMd(abs) {
  const md = readFileSync(abs, 'utf8');
  const fixed = md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
    if (/^https?:/.test(src)) return m;
    const target = resolve(dirname(abs), src);
    if (!existsSync(target)) {
      console.warn(`missing image: ${relative(docs, abs)} -> ${src}`);
      return `<p class="missing">[missing image: ${src}]</p>`;
    }
    return `![${alt}](${pathToFileURL(target).href})`;
  });
  return { html: marked.parse(fixed), chars: md.length };
}

// ── Abstract from docs/index.md ──────────────────────────────────────────────────────
const indexMd = readFileSync(join(docs, 'index.md'), 'utf8');
const abstractMd = (indexMd.match(/## Abstract\s*([\s\S]*?)(?=\n## |$)/) ?? [, ''])[1].trim();
if (abstractMd.length > 2000) console.warn(`abstract is ${abstractMd.length} chars (rules: up to 2000)`);

// ── Assemble the body: front matter, chapters, back matter ───────────────────────────
const toc = []; // {level, text, id, page}
let body = '';
const perChapter = {};
let chapterNo = 0;

function addUnnumbered(title, html) {
  const id = slug(title);
  toc.push({ level: 1, text: title, id });
  body += `<section class="chapter"><h1 class="chapter" id="${id}">${esc(title)}</h1>${html}</section>`;
}

function front(name) {
  const { html } = renderMd(join(here, 'front-matter', `${name}.md`));
  // the file's own h1 is the section title; drop it from the html
  const title = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) ?? [, name.toUpperCase()])[1]);
  addUnnumbered(title, html.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, ''));
}

// Order matters for the contents: introduction, chapters, conclusions, references.
front('introduction');

for (const ch of CHAPTERS) {
  chapterNo++;
  let secNo = 0;
  let subNo = 0;
  let figNo = 0;
  let tabNo = 0;
  let chapterHtml = '';
  let chars = 0;
  const files = ch.files.flatMap((p) => expand(ch.dir, p));
  let criteriaHeadingDone = false;

  for (const rel of files) {
    const abs = join(docs, ch.dir, rel);
    let { html, chars: n } = renderMd(abs);
    chars += n;
    const isIndex = rel === 'index.md';
    const isCriterion = rel.startsWith('criteria/');

    if (isCriterion && !criteriaHeadingDone) {
      secNo++;
      subNo = 0;
      const text = `${chapterNo}.${secNo}. Evaluation criteria as architecture decision records`;
      const id = slug(text);
      toc.push({ level: 2, text, id });
      chapterHtml += `<h2 id="${id}">${esc(text)}</h2><p>Each of the seven evaluation criteria of the project is documented below as an architecture decision record: the context, the decision, the alternatives considered, the consequences, the key decisions, the structure and a compliance checklist.</p>`;
      criteriaHeadingDone = true;
    }

    // Heading levels: chapter index h1 → chapter title; its h2 → N.k.; other files' h1 → N.k.;
    // criteria files' h1 → N.k.m. Everything deeper is unnumbered.
    html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (m, lv, text) => {
      const level = Number(lv);
      const t = text.trim();
      if (isIndex && level === 1) {
        const title = `${chapterNo}. ${strip(t).replace(/^\d+\.\s*/, '').toUpperCase()}`;
        const id = `chapter-${chapterNo}`;
        toc.push({ level: 1, text: title, id });
        return `<h1 class="chapter" id="${id}">${title}</h1>`;
      }
      const depth = isCriterion ? level + 2 : isIndex ? level : level + 1; // 2 = N.k., 3 = N.k.m.
      if (depth === 2) {
        secNo++;
        subNo = 0;
        const title = `${chapterNo}.${secNo}. ${strip(t)}`;
        const id = slug(title);
        toc.push({ level: 2, text: title, id });
        return `<h2 id="${id}">${title}</h2>`;
      }
      if (depth === 3) {
        subNo++;
        return `<h3>${chapterNo}.${secNo}.${subNo}. ${strip(t)}</h3>`;
      }
      return `<h4>${strip(t)}</h4>`;
    });

    // Figures: "Fig. N.k. Caption" below the image; tables: "Table N.k" top right + title centred.
    html = html.replace(/<p><img src="([^"]+)" alt="([^"]*)"\s*\/?><\/p>/g, (m, src, alt) => {
      figNo++;
      return `<figure><img src="${src}" alt="${esc(alt)}"><figcaption>Fig. ${chapterNo}.${figNo}. ${esc(alt)}</figcaption></figure>`;
    });
    html = html.replace(/<p>Table: ([^<]+)<\/p>\s*<table>/g, (m, cap) => {
      tabNo++;
      return `<div class="tcap"><div class="tnum">Table ${chapterNo}.${tabNo}</div><div class="ttitle">${cap}</div></div><table>`;
    });
    chapterHtml += html;
  }
  perChapter[ch.dir] = chars;
  body += `<section class="chapter">${chapterHtml}</section>`;
}

front('conclusions');
front('references');

// ── Title page and abstract ──────────────────────────────────────────────────────────
const titlePage = `<section class="title-page">
  <div class="tp-top"><p class="tp-univ">${esc(meta.university)}</p><p>${esc(meta.department)}</p><p>${esc(meta.program)}</p></div>
  <div class="tp-author"><p class="tp-name">${esc(meta.author)}</p><p>${esc(meta.year_of_study)}</p></div>
  <div class="tp-title"><p>${esc(meta.title)}</p><p class="tp-kind">${esc(meta.kind)}</p></div>
  <div class="tp-sup"><p>${esc(meta.supervisor)}</p></div>
  <div class="tp-bottom"><p>${esc(meta.city)}, ${esc(meta.year)}</p></div>
</section>`;
const abstractPage = `<section class="abstract">
  <p class="ab-author">${esc(meta.authorName)}</p>
  <p class="ab-title">${esc(meta.titleSentence)}</p>
  <p class="ab-keywords">Keywords: <em>${esc(meta.keywords)}</em></p>
  ${marked.parse(abstractMd)}
</section>`;

function tocHtml(pages) {
  return `<section class="toc"><h1 class="chapter">TABLE OF CONTENTS</h1><div class="toc-list">${toc
    .map((t) => `<div class="toc-row l${t.level}"><span class="toc-text"><a href="#${t.id}">${esc(t.text)}</a></span><span class="toc-dots"></span><span class="toc-page">${pages?.get(t.id) ?? ''}</span></div>`)
    .join('')}</div></section>`;
}

const page = (tocPages) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(meta.titleSentence)}</title><style>${css}</style></head><body>${titlePage}${abstractPage}${tocHtml(tocPages)}${body}</body></html>`;

// ── Report the character budget (title, abstract, references and appendices excluded) ──
const total = Object.values(perChapter).reduce((a, b) => a + b, 0) + readFileSync(join(here, 'front-matter', 'introduction.md')).length + readFileSync(join(here, 'front-matter', 'conclusions.md')).length;
for (const [key, [lo, hi]] of Object.entries(BUDGET)) {
  const n = perChapter[key] ?? 0;
  console.log(`  ${key.padEnd(20)} ${String(n).padStart(6)} chars  (${lo}–${hi}) ${n < lo ? 'below' : n > hi ? 'ABOVE' : 'ok'}`);
}
console.log(`  ${'total (main text)'.padEnd(20)} ${String(total).padStart(6)} chars  (36000–54000 per EHU rules; guide 32000–51500) ${total < 36000 ? 'below' : total > 51500 ? 'ABOVE' : 'ok'}`);

const htmlPath = join(out, 'thesis.html');
writeFileSync(htmlPath, page(null));
if (htmlOnly) process.exit(0);

// ── PDF rendering helpers ────────────────────────────────────────────────────────────
const browsers = [
  process.env.BROWSER_BIN,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter((b) => b && existsSync(b));
if (browsers.length === 0) {
  console.error('no Chromium-based browser found; set BROWSER_BIN');
  process.exit(1);
}
function printPdf(html, pdfPath) {
  const src = join(out, 'print.html');
  writeFileSync(src, html);
  execFileSync(browsers[0], [
    '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(out, 'profile')}`,
    '--no-pdf-header-footer', '--virtual-time-budget=10000', `--print-to-pdf=${pdfPath}`, pathToFileURL(src).href,
  ], { stdio: 'ignore' });
}
async function pageTexts(pdfPath) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), useSystemFonts: true }).promise;
  const texts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    texts.push(tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' '));
  }
  return texts;
}

// Pass 1: find the page of every contents entry (first page after the contents itself).
const pass1 = join(out, 'pass1.pdf');
printPdf(page(null), pass1);
const texts = await pageTexts(pass1);
const tocEnd = texts.findIndex((t, i) => i > 0 && t.includes('TABLE OF CONTENTS')) + 1;
const pages = new Map();
let searchFrom = tocEnd;
for (const t of toc) {
  const needle = t.text.replace(/\s+/g, ' ');
  let found = -1;
  for (let i = searchFrom; i < texts.length; i++) {
    if (texts[i].includes(needle)) { found = i; break; }
  }
  if (found < 0) { console.warn(`contents: page not found for "${t.text}"`); continue; }
  pages.set(t.id, found + 1);
  searchFrom = found;
}

// Pass 2: final layout with page numbers in the contents, then stamp page numbers.
const pdfPath = join(here, process.env.THESIS_PDF ?? 'Documentation.pdf');
printPdf(page(pages), pdfPath);
const doc = await PDFDocument.load(readFileSync(pdfPath));
const font = await doc.embedFont(StandardFonts.TimesRoman);
const mm = (v) => (v * 72) / 25.4;
doc.getPages().forEach((p, i) => {
  if (i === 0) return; // the title page carries no number
  const label = String(i + 1);
  const w = font.widthOfTextAtSize(label, 12);
  p.drawText(label, { x: p.getWidth() - mm(10) - w, y: p.getHeight() - mm(12), size: 12, font, color: rgb(0, 0, 0) });
});
writeFileSync(pdfPath, await doc.save());
console.log(`PDF: ${relative(process.cwd(), pdfPath)} — ${doc.getPageCount()} pages, ${Math.round(statSync(pdfPath).size / 1024)} KB`);

// Declaration: a separate document, outside the page numbering (rules 2.2).
const declPath = join(here, process.env.DECLARATION_PDF ?? 'Declaration.pdf');
const decl = marked.parse(readFileSync(join(here, 'declaration.md'), 'utf8'));
printPdf(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body><section class="declaration">${decl}</section></body></html>`, declPath);
console.log(`Declaration: ${relative(process.cwd(), declPath)}`);
