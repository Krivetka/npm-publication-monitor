// Static files for the SPA (src/web/static/) and whitelisted vendor packages from
// node_modules. Paths are resolved strictly under their root; anything else is 404.

import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATIC_ROOT = fileURLToPath(new URL('../web/static/', import.meta.url));
const NODE_MODULES = fileURLToPath(new URL('../../node_modules/', import.meta.url));

export const VENDOR_PACKAGES = ['preact', 'htm', 'swagger-ui-dist'] as const;
const VENDOR_EXT = new Set(['.js', '.mjs', '.css', '.map', '.png']);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export const contentType = (path: string): string => TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';

// Absolute path of `rel` under `root`, or null when it escapes the root or looks hostile.
export function resolveUnder(root: string, rel: string): string | null {
  if (rel.includes('\0') || rel.includes('\\') || rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s === '')) return null;
  const base = resolve(root);
  const abs = resolve(base, normalize(rel));
  return abs === base || abs.startsWith(base + sep) ? abs : null;
}

export function resolveVendor(pkg: string, rel: string): string | null {
  if (!(VENDOR_PACKAGES as readonly string[]).includes(pkg)) return null;
  if (!VENDOR_EXT.has(extname(rel).toLowerCase())) return null;
  return resolveUnder(resolve(NODE_MODULES, pkg), rel);
}

export function spaIndexPath(): string | null {
  const p = resolve(STATIC_ROOT, 'index.html');
  return existsSync(p) ? p : null;
}

export async function serveFile(res: ServerResponse, abs: string, headers: Record<string, string>, head = false): Promise<boolean> {
  let size: number;
  try {
    const st = statSync(abs);
    if (!st.isFile()) return false;
    size = st.size;
  } catch {
    return false;
  }
  res.writeHead(200, { 'content-type': contentType(abs), 'content-length': String(size), 'cache-control': 'no-cache', ...headers });
  if (head) {
    res.end();
    return true;
  }
  res.end(await readFile(abs));
  return true;
}
