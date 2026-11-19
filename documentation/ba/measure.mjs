// Page spans of the parts of BA_Kuliashov_Ivan.pdf (run after convert-ba.ps1).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'package.json'));
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.mjs');
const pdf = await getDocument({ data: new Uint8Array(readFileSync(join(here, 'BA_Kuliashov_Ivan.pdf'))), useSystemFonts: true }).promise;
const pages = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const t = (await (await pdf.getPage(p)).getTextContent()).items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
  pages.push(t);
}
const find = (re, from = 2) => pages.findIndex((t, i) => i >= from && re.test(t)) + 1;
const b = { intro: find(/^\d+ INTRODUCTION/), ch1: find(/^\d+ CHAPTER 1\./), ch2: find(/^\d+ CHAPTER 2\./), refs: find(/^\d+ REFERENCES/), appA: find(/^\d+ APPENDIX A/), appB: find(/^\d+ APPENDIX B/), st: find(/^\d+ STATEMENTS/) };
console.log(`total ${pdf.numPages} | main text ${b.refs - b.intro} pages: introduction ${b.ch1 - b.intro}, chapter 1 ${b.ch2 - b.ch1}, chapter 2 ${b.refs - b.ch2} | references ${b.appA - b.refs}, appendix A ${b.appB - b.appA}, appendix B ${b.st - b.appB}`);
console.log('sparse pages (< 400 chars):', pages.map((t, i) => [i + 1, t.length]).filter(([, n]) => n < 400).map(([p, n]) => `${p}:${n}`).join(' '));
console.log('TOC:', pages[1].slice(0, 700));
