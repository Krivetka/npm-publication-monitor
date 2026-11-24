// Unit tests of the front-end: the form validators, the error service, and the key components
// rendered to markup. They run in Node without a browser; the flows in a real browser are in
// test/e2e/.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { html } from 'htm/preact';
import { renderToString } from 'preact-render-to-string';
import { ErrorBox, EventTable, Field, Loading, Meter, PageSkeleton, Verdict } from '../src/web/static/components.js';
import { describeError, dismiss, ErrorBoundary, notify, Toasts, toastStore } from '../src/web/static/errors.js';
import { LIMITS, normalisePackageName, validateDependencyCount, validateMinScore, validatePackageName, validateToken, validateVerdict } from '../src/web/static/forms.js';
import { lazy } from '../src/web/static/lazy.js';
import { VerdictForm } from '../src/web/static/verdict-form.js';

const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });
const count = (text: string, part: string) => text.split(part).length - 1;

describe('form validation', () => {
  it('package name: lowered, npm rules, a message that says what to fix', () => {
    assert.equal(normalisePackageName('  Lodash '), 'lodash');
    assert.equal(validatePackageName('lodash'), null);
    assert.equal(validatePackageName('@scope/name'), null);
    assert.equal(validatePackageName('  @Scope/Name  '), null);
    assert.match(validatePackageName('')!, /Type a package name/);
    assert.match(validatePackageName('two words')!, /no spaces/);
    assert.match(validatePackageName('@scope')!, /@scope\/name/);
    assert.match(validatePackageName('name!')!, /lower-case letters/);
    assert.match(validatePackageName('x'.repeat(215))!, /at most 214/);
  });

  it('minimum score: empty is no filter, a comma is a decimal point, the range is checked', () => {
    assert.deepEqual(validateMinScore(''), { value: null, error: null });
    assert.deepEqual(validateMinScore(' 4,5 '), { value: 4.5, error: null });
    assert.deepEqual(validateMinScore('0'), { value: 0, error: null });
    assert.match(validateMinScore('four').error!, /Type a number/);
    assert.match(validateMinScore('0x10').error!, /Type a number/);
    assert.match(validateMinScore('1e1').error!, /Type a number/);
    assert.match(validateMinScore('-1').error!, /between 0 and 20/);
    assert.match(validateMinScore('21').error!, /between 0 and 20/);
  });

  it('token: required, no spaces, a minimum length', () => {
    assert.match(validateToken('')!, /required/);
    assert.match(validateToken('with space inside it')!, /no spaces/);
    assert.match(validateToken('short')!, /at least 16/);
    assert.equal(validateToken('a'.repeat(LIMITS.tokenMin)), null);
  });

  it('verdict: limits of the fields, a link must be http(s), a confirmed verdict says why', () => {
    assert.deepEqual(validateVerdict({ verdict: 'false_positive' }), {});
    assert.deepEqual(validateVerdict({ verdict: 'undecided', note: '', reference: '' }), {});
    assert.deepEqual(validateVerdict({ verdict: 'confirmed', note: 'removed by the registry' }), {});
    assert.deepEqual(validateVerdict({ verdict: 'confirmed', reference: 'GHSA-xxxx-xxxx-xxxx' }), {});
    assert.match(validateVerdict({ verdict: 'confirmed' }).note!, /needs a note or a reference/);
    assert.match(validateVerdict({ verdict: 'maybe' }).verdict!, /Choose a verdict/);
    assert.match(validateVerdict({ verdict: 'undecided', note: 'x'.repeat(2001) }).note!, /limit is 2000/);
    assert.match(validateVerdict({ verdict: 'undecided', reference: 'x'.repeat(501) }).reference!, /limit is 500/);
    assert.match(validateVerdict({ verdict: 'undecided', reference: 'javascript:alert(1)' }).reference!, /http/);
    // a reference in words with a colon is not a link
    assert.deepEqual(validateVerdict({ verdict: 'undecided', reference: 'CVE-2024-1234: see the advisory' }), {});
    assert.deepEqual(validateVerdict({ verdict: 'undecided', reference: 'https://example.org/advisory' }), {});
    // the edge of the limit is valid
    assert.deepEqual(validateVerdict({ verdict: 'undecided', note: 'x'.repeat(2000) }), {});
  });

  it('dependency list: empty and oversized lists are refused', () => {
    assert.match(validateDependencyCount(0)!, /No package name found/);
    assert.match(validateDependencyCount(10_001)!, /limit is 10000/);
    assert.equal(validateDependencyCount(1), null);
    assert.equal(validateDependencyCount(10_000), null);
  });
});

describe('error service', () => {
  it('describes a failure by its status and says whether a retry can help', () => {
    assert.deepEqual(describeError(apiError(400, 'limit: must be >= 1')), { title: 'The request was not accepted', text: 'limit: must be >= 1', retry: false });
    assert.equal(describeError(apiError(401, 'analyst token required')).title, 'The analyst token is missing or wrong');
    assert.equal(describeError(apiError(403, 'forbidden')).title, 'Not allowed');
    assert.deepEqual(describeError(apiError(404, 'no such event')), { title: 'Not found', text: 'no such event', retry: false });
    assert.equal(describeError(apiError(413, 'body too large')).retry, false);
    assert.deepEqual(describeError(apiError(500, 'internal error')), { title: 'The server failed', text: 'The request did not go through. It is safe to try again.', retry: true });
    assert.equal(describeError(apiError(503, 'x')).retry, true);
    assert.equal(describeError(Object.assign(new Error('Failed to fetch'), { status: 0 })).title, 'No connection to the server');
    // a TypeError of the page itself is not a network failure
    assert.equal(describeError(new TypeError('x is not a function')).title, 'Something went wrong');
    assert.equal(describeError(new Error('bug')).title, 'Something went wrong');
    assert.equal(describeError(null).title, 'Something went wrong');
  });

  it('toasts: the same message is not stacked, at most four stay, a toast can be dismissed', () => {
    for (const t of toastStore.get()) dismiss(t.id);
    const seen: number[] = [];
    const off = toastStore.subscribe((items) => seen.push(items.length));
    const id = notify('error', 'The server failed', 'try again', 0);
    assert.equal(notify('error', 'The server failed', 'try again', 0), null, 'a duplicate is dropped');
    assert.equal(toastStore.get().length, 1);
    for (let i = 0; i < 6; i++) notify('ok', `saved ${i}`, '', 0);
    assert.equal(toastStore.get().length, 4);
    dismiss(id!);
    for (const t of toastStore.get()) dismiss(t.id);
    assert.equal(toastStore.get().length, 0);
    assert.ok(seen.length >= 8 && seen.at(-1) === 0);
    off();
  });

  it('Toasts component: an error is an alert, a confirmation is a status', () => {
    const out = renderToString(html`<${Toasts} items=${[{ id: 1, kind: 'error', title: 'The server failed', text: 'try again' }, { id: 2, kind: 'ok', title: 'Verdict stored', text: '' }]} />`);
    assert.equal(count(out, 'role="alert"'), 1);
    assert.equal(count(out, 'role="status"'), 1);
    assert.ok(out.includes('aria-live="polite"') && out.includes('aria-label="Dismiss"'));
  });

  it('error boundary: keeps the failure in its state and renders a way out', () => {
    assert.deepEqual(ErrorBoundary.getDerivedStateFromError(new Error('boom')), { error: new Error('boom') });
    const boundary = new ErrorBoundary({ home: '/npm/', children: 'the page' });
    assert.equal(boundary.render(), 'the page', 'without a failure the children are rendered');
    boundary.state = { error: apiError(500, 'internal error') };
    const out = renderToString(boundary.render());
    assert.ok(out.includes('This page could not be shown') && out.includes('The server failed'));
    assert.ok(out.includes('Try again') && out.includes('href="/npm/"'));
  });
});

describe('components', () => {
  it('Meter: the fill and the threshold tick are positioned on the scale; an alert is marked', () => {
    const cold = renderToString(html`<${Meter} value=${2} scaleMax=${10} threshold=${4} />`);
    assert.ok(cold.includes('width:20.0%') && cold.includes('left:40.0%') && !cold.includes('hot'));
    const hot = renderToString(html`<${Meter} value=${6.5} scaleMax=${10} threshold=${4} hot=${true} />`);
    assert.ok(hot.includes('class="fill hot"') && hot.includes('>6.5<'));
    // a score above the scale stretches the scale instead of overflowing the track
    const over = renderToString(html`<${Meter} value=${12} scaleMax=${10} threshold=${4} />`);
    assert.ok(over.includes('width:100.0%') && over.includes('left:33.3%'));
  });

  it('Verdict: one label for each state of an event, never colour alone', () => {
    const v = (row: Record<string, unknown>) => renderToString(html`<${Verdict} row=${row} />`);
    assert.ok(v({ stage1: { candidate: true }, stage2: { alert: true } }).includes('alert'));
    assert.ok(v({ stage1: { candidate: true }, stage2: { alert: false } }).includes('no alert'));
    assert.ok(v({ stage1: { candidate: true }, stage2: null }).includes('awaiting enrichment'));
    assert.ok(v({ stage1: { candidate: false }, stage2: null }).includes('did not pass'));
    assert.ok(v({ stage1: null, stage2: null }).includes('—'));
    assert.ok(v({ stage2: { alert: true } }).includes('<svg'), 'the alert carries an icon');
  });

  const row = {
    seq: 1014,
    package: '@acme/widgets',
    observed_at: '2026-11-24T14:17:32.816Z',
    stage1: { prescore: 3.5, candidate: true, features: [{ id: 'name_scope_typo', lane: 'nominal', value: '@acme/widgets', weight: 2 }] },
    stage2: { kind: 'publish', versions: ['0.1.0'], final_score: 6, alert: true, features: [{ id: 'install_script_new_package', lane: 'manifest', value: ['preinstall'], weight: 2.5 }] },
  };

  it('EventTable: a row links to the card and to the package; both stages show their features', () => {
    const out = renderToString(html`<${EventTable} rows=${[row]} mode="enriched" />`);
    assert.ok(out.includes('href="/npm/event/1014"'));
    assert.ok(out.includes('href="/npm/package/%40acme%2Fwidgets"'), 'a scoped name is encoded in the link');
    assert.ok(out.includes('0.1.0') && out.includes('class="fill hot"'));
    assert.equal(count(out, 'class="chip"'), 2);
    for (const head of ['Time', 'Package', 'Versions', 'Score', 'Verdict', 'Features']) assert.ok(out.includes(`<th>${head}</th>`), head);
  });

  it('EventTable in stage-1 mode shows the preliminary score on its own scale; an empty list has only the header', () => {
    const out = renderToString(html`<${EventTable} rows=${[{ ...row, stage1: { ...row.stage1, prescore: 2 }, stage2: null }]} mode="stage1" />`);
    assert.ok(out.includes('Prescore') && out.includes('awaiting enrichment'));
    assert.ok(out.includes('left:66.7%'), 'threshold 2 on a scale to 3');
    assert.equal(count(renderToString(html`<${EventTable} rows=${[]} />`), '<tr>'), 1);
  });

  it('ErrorBox: an alert with a text for the status; a retry only when it can help', () => {
    const retry = () => {};
    const server = renderToString(html`<${ErrorBox} error=${apiError(500, 'internal error')} retry=${retry} />`);
    assert.ok(server.includes('role="alert"') && server.includes('The server failed') && server.includes('Try again'));
    const missing = renderToString(html`<${ErrorBox} error=${apiError(404, 'no such event')} retry=${retry} />`);
    assert.ok(missing.includes('Not found') && missing.includes('no such event') && !missing.includes('Try again'));
    assert.ok(!renderToString(html`<${ErrorBox} error=${apiError(500, 'x')} />`).includes('<button'), 'no retry handler, no button');
  });

  it('Loading and PageSkeleton: a status for assistive technology and lines in the place of the content', () => {
    const out = renderToString(html`<${Loading} lines=${3} />`);
    assert.ok(out.includes('role="status"') && out.includes('Loading…'));
    assert.equal(count(out, 'class="sk-line"'), 3);
    const page = renderToString(html`<${PageSkeleton} />`);
    assert.ok(page.includes('Loading the page…') && page.includes('<main'));
  });

  it('Field: the label is tied to the input; an error replaces the hint and is announced', () => {
    const ok = renderToString(html`<${Field} id="vc-note" label="Note" hint="why this verdict"><input id="vc-note" /></${Field}>`);
    assert.ok(ok.includes('<label for="vc-note">Note</label>') && ok.includes('id="vc-note-hint"') && !ok.includes('invalid'));
    const bad = renderToString(html`<${Field} id="vc-note" label="Note" hint="why" error="Too long."><input id="vc-note" /></${Field}>`);
    assert.ok(bad.includes('class="field invalid"') && bad.includes('id="vc-note-error"') && bad.includes('role="alert"') && !bad.includes('vc-note-hint'));
  });

  it('VerdictForm: asks for the token only when the browser has none; shows the stored verdict', () => {
    const client = {
      putFinding: async () => {
        throw new Error('not called');
      },
      deleteFinding: async () => null,
    };
    const noToken = renderToString(html`<${VerdictForm} seq=${1014} finding=${null} onSaved=${() => {}} client=${client} tokens=${{ get: () => '', set: () => {} }} />`);
    assert.ok(noToken.includes('id="vc-token"') && noToken.includes('type="password"'));
    assert.ok(noToken.includes('<form') && noToken.includes('novalidate') && noToken.includes('type="submit"'));
    assert.equal(count(noToken, 'aria-pressed="true"'), 1, 'one verdict is selected');
    assert.ok(!noToken.includes('Remove'), 'nothing to remove yet');
    assert.ok(!noToken.includes('role="alert"'), 'no message before the first submit');

    const finding = { seq: 1014, verdict: 'confirmed', note: 'removed by the registry', decided_at: '2026-11-24T15:20:03.417Z' };
    const withToken = renderToString(html`<${VerdictForm} seq=${1014} finding=${finding} onSaved=${() => {}} client=${client} tokens=${{ get: () => 'a'.repeat(32), set: () => {} }} />`);
    assert.ok(!withToken.includes('vc-token'), 'the token field is hidden');
    assert.ok(withToken.includes('value="removed by the registry"') && withToken.includes('Remove'));
    assert.ok(/class="vbtn confirmed"[^>]*aria-pressed="true"/.test(withToken));
    assert.ok(withToken.includes('23 of 2000'), 'the counter of the note');
  });

  it('lazy: shows the skeleton until the page module arrives', async () => {
    let loads = 0;
    const Page = lazy(
      async () => {
        loads++;
        return { View: () => html`<p>the page</p>` };
      },
      (m) => m.View,
    );
    assert.ok(renderToString(html`<${Page} />`).includes('Loading the page…'));
    assert.equal(loads, 0, 'the module is requested when the page mounts, not when it is declared');
  });
});
