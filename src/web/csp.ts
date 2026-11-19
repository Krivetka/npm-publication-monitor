// Content-Security-Policy for the dashboard. The SPA shell carries an inline
// `<script type="importmap">` (import maps cannot be external), so its SHA-256 hash is
// whitelisted instead of 'unsafe-inline'; it is computed from the file at start-up.

import { createHash } from 'node:crypto';

export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(m[1] ?? '')) continue;
    out.push(`'sha256-${createHash('sha256').update(m[2] ?? '', 'utf8').digest('base64')}'`);
  }
  return out;
}

export function buildCsp(scriptHashes: string[] = []): string {
  const script = ["'self'", ...scriptHashes].join(' ');
  return [
    "default-src 'none'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
}
