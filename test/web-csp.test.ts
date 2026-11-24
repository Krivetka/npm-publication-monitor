import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildCsp, inlineScriptHashes } from '../src/web/csp.ts';

describe('CSP', () => {
  it('whitelists inline scripts (the import map) by hash and ignores external ones', () => {
    const html = `<script type="importmap">{"imports":{}}</script><script src="./app.js" type="module"></script>`;
    const expected = `'sha256-${createHash('sha256').update('{"imports":{}}').digest('base64')}'`;
    assert.deepEqual(inlineScriptHashes(html), [expected]);
    assert.match(buildCsp([expected]), new RegExp(`script-src 'self' ${expected.replace(/[+/=]/g, (c) => `\\${c}`)};`));
    assert.match(buildCsp(), /script-src 'self';/);
  });

  it('the shipped SPA shell has exactly one inline script, the import map', () => {
    const html = readFileSync(new URL('../src/web/static/index.html', import.meta.url), 'utf8');
    assert.equal(inlineScriptHashes(html).length, 1);
    assert.match(html, /<script type="importmap">/);
  });
});
