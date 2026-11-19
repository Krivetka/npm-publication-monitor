// Assembles the submission archive in the layout required by the thesis guide:
//   <LastName>_<FirstName>_Diploma.zip
//   ├── documentation/docs/**        Markdown sources
//   ├── documentation/<LastName>_Documentation.pdf
//   ├── source-code/npm-monitor.zip  git archive of HEAD (no node_modules, no .env)
//   ├── presentation/<LastName>_Presentation.pptx   (if present in documentation/submission/)
//   └── video/<LastName>_Demo.mp4 or README.md with a link
// Usage: node documentation/package.mjs <LastName> <FirstName>

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [last, first] = process.argv.slice(2);
if (!last || !first) {
  console.error('usage: node documentation/package.mjs <LastName> <FirstName>');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const stage = join(here, 'build', 'submission');
const extras = join(here, 'submission'); // presentation / video dropped here by hand
rmSync(stage, { recursive: true, force: true });

// documentation
mkdirSync(join(stage, 'documentation'), { recursive: true });
cpSync(join(here, 'docs'), join(stage, 'documentation', 'docs'), { recursive: true });
const pdf = `${last}_Documentation.pdf`;
execFileSync(process.execPath, [join(here, 'build.mjs')], { env: { ...process.env, THESIS_PDF: pdf }, stdio: 'inherit' });
cpSync(join(here, pdf), join(stage, 'documentation', pdf));

// source code: a clean git archive of HEAD
mkdirSync(join(stage, 'source-code'), { recursive: true });
execFileSync('git', ['archive', '--format=zip', '-o', join(stage, 'source-code', 'npm-monitor.zip'), 'HEAD'], { cwd: repo, stdio: 'inherit' });

// presentation and video
for (const [dir, pattern, fallback] of [
  ['presentation', /\.pptx$/i, null],
  ['video', /\.(mp4|md)$/i, `# Demo video\n\n[VIDEO LINK]\n`],
]) {
  mkdirSync(join(stage, dir), { recursive: true });
  const found = existsSync(extras) ? readdirSync(extras).filter((f) => pattern.test(f)) : [];
  for (const f of found) cpSync(join(extras, f), join(stage, dir, f));
  if (found.length === 0 && fallback) writeFileSync(join(stage, dir, 'README.md'), fallback);
  if (found.length === 0) console.warn(`${dir}: nothing found in documentation/submission/`);
}

const zip = join(here, `${last}_${first}_Diploma.zip`);
rmSync(zip, { force: true });
// PowerShell's Compress-Archive is available on every Windows; zip(1) elsewhere.
if (process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}'`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-qr', zip, '.'], { cwd: stage, stdio: 'inherit' });
}
console.log(`${zip} (${Math.round(statSync(zip).size / 1024)} KB)`);
