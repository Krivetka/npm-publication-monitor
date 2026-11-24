// Validation of the forms of the dashboard. Pure functions: a form calls them on every change
// and on submit, and shows the message next to the field. The server validates again; these
// rules give the answer before a request is made.

const PACKAGE_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
export const LIMITS = { name: 214, note: 2000, reference: 500, tokenMin: 16, scoreMax: 20 };
// a reference that looks like a link: a scheme with //, or a scheme that a browser runs or opens.
// "CVE-2024-1234: note" is a reference in words and passes.
const LINK_LIKE = /^([a-z][a-z0-9+.-]*:\/\/|(javascript|data|vbscript|file|mailto):)/i;
export const VERDICTS = ['confirmed', 'false_positive', 'undecided'];

// Package search. Names are lower case in the registry, so the form lowers the input first.
export function normalisePackageName(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}
export function validatePackageName(raw) {
  const name = normalisePackageName(raw);
  if (name === '') return 'Type a package name.';
  if (name.length > LIMITS.name) return `A package name has at most ${LIMITS.name} characters.`;
  if (/\s/.test(name)) return 'A package name has no spaces.';
  if (name.startsWith('@') && !name.includes('/')) return 'A scoped name is @scope/name.';
  if (!PACKAGE_RE.test(name)) return 'Use lower-case letters, digits, dots, hyphens and underscores, for example lodash or @scope/name.';
  return null;
}

// "score from" filter of the lists: empty means no filter.
export function validateMinScore(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(',', '.');
  if (text === '') return { value: null, error: null };
  // 0x10 and 1e1 are numbers for Number(); a score is written in digits
  const value = /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isFinite(value)) return { value: null, error: 'Type a number, for example 4 or 4.5.' };
  if (value < 0 || value > LIMITS.scoreMax) return { value: null, error: `The score is between 0 and ${LIMITS.scoreMax}.` };
  return { value, error: null };
}

export function validateToken(raw) {
  const token = String(raw ?? '').trim();
  if (token === '') return 'The analyst token is required to store a verdict.';
  if (/\s/.test(token)) return 'A token has no spaces.';
  if (token.length < LIMITS.tokenMin) return `A token has at least ${LIMITS.tokenMin} characters.`;
  return null;
}

// Verdict form. Returns the errors by field; an empty object means the form is valid.
export function validateVerdict({ verdict, note = '', reference = '' }) {
  const errors = {};
  const n = String(note).trim();
  const r = String(reference).trim();
  if (!VERDICTS.includes(verdict)) errors.verdict = 'Choose a verdict.';
  if (n.length > LIMITS.note) errors.note = `The note has ${n.length} characters; the limit is ${LIMITS.note}.`;
  if (r.length > LIMITS.reference) errors.reference = `The reference has ${r.length} characters; the limit is ${LIMITS.reference}.`;
  else if (LINK_LIKE.test(r) && !/^https?:\/\/\S+$/i.test(r)) errors.reference = 'A link must start with http:// or https:// and have no spaces.';
  // a confirmed finding is used as ground truth: it must say why
  if (verdict === 'confirmed' && n === '' && r === '' && !errors.note && !errors.reference) errors.note = 'A confirmed verdict needs a note or a reference: say what confirms it.';
  return errors;
}

// The list of dependencies is validated by deps.js (it parses the file); this is the size rule.
export function validateDependencyCount(count, max = 10000) {
  if (count === 0) return 'No package name found. Paste a package-lock.json, a package.json or one name per line.';
  if (count > max) return `The list has ${count} names; the limit is ${max}.`;
  return null;
}
