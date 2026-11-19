// Builds the BA block as one HTML file for Word: title page, TOC placeholder, Introduction,
// Chapter 1, Chapter 2, References, Appendix A, Appendix B, Statements. The PowerShell script
// convert-ba.ps1 then opens it in Word, embeds the images, inserts a real table of contents,
// adds page numbers and saves BA_Kuliashov_Ivan.docx and a PDF for page counting.
//   node documentation/ba/build-ba.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(join(here, '..', 'meta.json'), 'utf8'));
// --lang ru: Russian review copy from documentation/ba/ru/*.md (same file names), output BA_ru.html
const lang = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : 'en';
const md = (name) => readFileSync(join(here, lang === 'en' ? '.' : lang, name), 'utf8');
const T = lang === 'ru'
  ? { toc: 'ОГЛАВЛЕНИЕ', dept: 'Академический департамент информатики', prog: 'Программа: Informatika (бакалавриат, заочная форма)', year: 'студент 5-го курса', kind: 'БАКАЛАВРСКИЙ ПРОЕКТ', block: 'Блок бизнес-анализа: введение, глава 1 (аналитическая часть), глава 2 (требования к системе)', type: 'Тип проекта: индивидуальный', sup: 'Руководитель: dr hab., prof. UKEN Serhii Semenov', note: 'Русская версия для проверки автором; подаётся английская версия.' }
  : { toc: 'TABLE OF CONTENTS', dept: meta.department, prog: meta.program, year: meta.year_of_study, kind: meta.kind, block: 'Business analysis block: Introduction, Chapter 1 (Analytical part), Chapter 2 (System requirements)', type: 'Project type: individual', sup: meta.supervisor, note: '' };

// Images: absolute file paths, fixed width in px (A4 text width ≈ 605 px at 96 dpi). Word keeps
// the intrinsic height unless both attributes are given, so the height is computed from the PNG.
function pngSize(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(12) === 0x49484452) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; // PNG IHDR
  if (b[0] === 0xff && b[1] === 0xd8) {
    // JPEG: walk the markers to the first SOF segment
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) throw new Error(`bad JPEG marker in ${file}`);
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  throw new Error(`unsupported image: ${file}`);
}
// maxH caps the height (landscape Appendix B pages: 170 mm ≈ 640 px minus the caption)
const imgTag = (file, width, alt = '', maxH = Infinity) => {
  const { w, h } = pngSize(file);
  if ((width * h) / w > maxH) width = Math.round((maxH * w) / h);
  const abs = resolve(file).replace(/\\/g, '/');
  return `<img src="file:///${abs}" width="${width}" height="${Math.round((width * h) / w)}" alt="${alt}">`;
};
let figWidth = 560; // Appendix B is set in landscape by convert-ba.ps1: wider figures there
const renderer = new marked.Renderer();
renderer.image = ({ href, text }) =>
  `<p class="fig">${imgTag(resolve(here, href), figWidth, text, figWidth === 900 ? 540 : Infinity)}</p>${figWidth === 900 ? '' : `<p class="cap">${text}</p>`}`;
marked.use({ renderer, gfm: true });

// Count main-text characters (introduction + chapters) for the page estimate
const plain = (s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#*_`|>\-]+/g, ' ').replace(/\s+/g, ' ').trim();
const parts = {
  intro: md('00-introduction.md'),
  ch1: md('01-analysis.md'),
  ch2: md('02-requirements.md'),
};
for (const [k, v] of Object.entries(parts)) console.error(`${k}: ${plain(v).length} chars`);

const pageBreak = '<br clear="all" style="page-break-before:always">';
const title = `
<div class="title">
<p class="t2">${meta.university}</p>
<p class="t3">&nbsp;</p>
<p class="t2">${T.dept}</p>
<p class="t2">${T.prog}</p>
${'<p class="t3">&nbsp;</p>'.repeat(8)}
<p class="t4">${meta.author}</p>
<p class="t2">${T.year}</p>
${'<p class="t3">&nbsp;</p>'.repeat(4)}
<p class="t5">${meta.title}</p>
<p class="t3">&nbsp;</p>
<p class="t2">${T.kind}</p>
<p class="t2">${T.block}</p>
<p class="t2">${T.type}</p>
${T.note ? `<p class="t2"><i>${T.note}</i></p>` : ''}
${'<p class="t3">&nbsp;</p>'.repeat(6)}
<p class="t6">${T.sup}</p>
${'<p class="t3">&nbsp;</p>'.repeat(14)}
<p class="t2">${meta.city}, ${meta.year}</p>
</div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>BA block — ${meta.titleSentence}</title>
<style>
@page { size: 21cm 29.7cm; margin: 2cm 2cm 2cm 2.5cm; }
body { font-family: "Times New Roman", serif; font-size: 12pt; line-height: 1.5; }
h1 { font-size: 14pt; font-weight: bold; text-align: center; text-transform: uppercase; margin: 0 0 12pt; page-break-before: always; }
h2 { font-size: 13pt; font-weight: bold; margin: 14pt 0 6pt; }
h3 { font-size: 12pt; font-weight: bold; margin: 12pt 0 6pt; }
p { margin: 0 0 6pt; text-align: justify; }
li { margin: 0 0 3pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 10pt; line-height: 1.15; }
th, td { border: 1px solid #000; padding: 3pt 5pt; vertical-align: top; text-align: left; }
th { font-weight: bold; }
p.fig { text-align: center; margin: 8pt 0 2pt; }
p.cap { text-align: center; font-style: italic; font-size: 11pt; margin: 0 0 10pt; }
code { font-family: "Courier New", monospace; font-size: 10.5pt; }
.title p { text-align: center; margin: 0; line-height: 1.3; }
.title .t4 { font-weight: bold; font-size: 14pt; }
.title .t5 { font-weight: bold; font-size: 14pt; text-transform: uppercase; }
.title .t6 { text-align: right; }
p.toc-placeholder { text-align: left; }
p.tochead { font-size: 14pt; font-weight: bold; text-align: center; margin: 0 0 12pt; }
table.figs { border: none; width: 100%; margin: 6pt 0 8pt; }
table.figs td { border: none; width: 50%; text-align: center; vertical-align: top; padding: 2pt 4pt; font-style: italic; font-size: 10.5pt; }
</style></head><body>
${title}
${pageBreak}
<p class="tochead">${T.toc}</p>
<p class="toc-placeholder">[[TOC]]</p>
${marked.parse(parts.intro)}
${marked.parse(parts.ch1)}
${marked.parse(parts.ch2)}
${marked.parse(md('references.md'))}
${marked.parse(md('appendix-a.md'))}
${((figWidth = 900), marked.parse(md('appendix-b.md')))}
${((figWidth = 560), marked.parse(md('statements.md')))}
</body></html>`.replace(/<img src="assets\/([^"]+)" width="(\d+)">/g, (m, file, width) => imgTag(join(here, 'assets', file), Number(width)));
// cap very wide-and-short pairs: nothing to do, Word scales by the attributes

// --out <file>: write elsewhere (e.g. when Word still holds BA.html open)
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? resolve(process.argv[outArg + 1]) : join(here, lang === 'en' ? 'BA.html' : `BA_${lang}.html`);
writeFileSync(out, html);
console.error(`written ${out}`);
