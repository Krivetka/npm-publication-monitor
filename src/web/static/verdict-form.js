// The verdict form of the event card: a controlled form with validation.
// PUT /events/{seq}/finding needs the analyst token; the token is typed once, validated and kept
// in this browser. Every field shows its own message; the form does not send while one is open.

import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api, getToken, setToken } from './api.js';
import { Field } from './components.js';
import { describeError, notify } from './errors.js';
import * as f from './format.js';
import { LIMITS, validateToken, validateVerdict } from './forms.js';
import { Icon } from './icons.js';

const OPTIONS = [
  ['confirmed', 'Confirmed', 'alert'],
  ['false_positive', 'False positive', 'check'],
  ['undecided', 'Undecided', 'clock'],
];

// `client` is the API service; a test passes its own.
export function VerdictForm({ seq, finding, onSaved, client = api, tokens = { get: getToken, set: setToken } }) {
  const [verdict, setVerdict] = useState(finding?.verdict ?? 'undecided');
  const [note, setNote] = useState(finding?.note ?? '');
  const [reference, setReference] = useState(finding?.reference ?? '');
  const [token, setTokenText] = useState('');
  const [needToken, setNeedToken] = useState(() => !tokens.get());
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'ok' | 'error', text }
  useEffect(() => {
    setVerdict(finding?.verdict ?? 'undecided');
    setNote(finding?.note ?? '');
    setReference(finding?.reference ?? '');
    setTouched(false);
  }, [finding]);

  const errors = validateVerdict({ verdict, note, reference });
  const tokenError = needToken ? validateToken(token) : null;
  const shown = touched ? { ...errors, token: tokenError } : {};
  const invalid = Object.keys(errors).length > 0 || tokenError !== null;

  const send = async (remove) => {
    setTouched(true);
    setStatus(null);
    // removing a verdict needs the token, not the fields
    if (remove ? tokenError !== null : invalid) return;
    if (needToken) tokens.set(token.trim());
    setBusy(true);
    try {
      const stored = remove ? await client.deleteFinding(seq) : await client.putFinding(seq, { verdict, note: note.trim() || undefined, reference: reference.trim() || undefined });
      setNeedToken(false);
      setTokenText('');
      setTouched(false);
      setStatus({ kind: 'ok', text: remove ? 'Verdict removed.' : 'Verdict stored.' });
      notify('ok', remove ? 'Verdict removed' : 'Verdict stored');
      onSaved(remove ? null : stored);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // the stored token is wrong: forget it and ask again, in the form
        tokens.set('');
        setNeedToken(true);
        setTokenText('');
      }
      const d = describeError(e);
      setStatus({ kind: 'error', text: `Not stored. ${d.title}. ${d.text}` });
    } finally {
      setBusy(false);
    }
  };
  const onSubmit = (e) => {
    e.preventDefault();
    send(false);
  };

  return html`<section aria-labelledby="vc-h"><h2 id="vc-h">Analyst verdict</h2>
    <form class="panel verdict-box" onSubmit=${onSubmit} novalidate>
      <div class="opts" role="group" aria-label="Verdict">${OPTIONS.map(([k, label, icon]) => html`<button type="button" key=${k} class=${`vbtn ${k}`} aria-pressed=${verdict === k ? 'true' : 'false'} onClick=${() => setVerdict(k)}><${Icon} name=${icon} size=${14} stroke=${2.4} />${label}</button>`)}</div>
      <div class="row">
        <${Field} id="vc-note" label="Note" error=${shown.note} hint=${`why this verdict · ${note.trim().length} of ${LIMITS.note}`}>
          <input id="vc-note" type="text" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} aria-invalid=${shown.note ? 'true' : null} aria-describedby=${shown.note ? 'vc-note-error' : 'vc-note-hint'} />
        </${Field}>
        <${Field} id="vc-ref" label="Reference" error=${shown.reference} hint="advisory id or a link to a write-up">
          <input id="vc-ref" type="text" value=${reference} onInput=${(e) => setReference(e.currentTarget.value)} aria-invalid=${shown.reference ? 'true' : null} aria-describedby=${shown.reference ? 'vc-ref-error' : 'vc-ref-hint'} />
        </${Field}>
      </div>
      ${
        needToken &&
        html`<div class="row"><${Field} id="vc-token" label="Analyst token" error=${shown.token} hint="ANALYST_TOKEN of the server; kept in this browser only">
        <input id="vc-token" type="password" autocomplete="off" value=${token} onInput=${(e) => setTokenText(e.currentTarget.value)} aria-invalid=${shown.token ? 'true' : null} aria-describedby=${shown.token ? 'vc-token-error' : 'vc-token-hint'} />
      </${Field}></div>`
      }
      <div class="row actions">
        <button type="submit" class="btn" disabled=${busy}>${busy ? 'Storing…' : 'Store verdict'}</button>
        ${finding && html`<button type="button" class="btn secondary" disabled=${busy} onClick=${() => send(true)}>Remove</button>`}
        ${finding && html`<span class="muted">stored ${f.time(finding.decided_at)}</span>`}
        ${status && html`<span class=${`form-status ${status.kind}`} role=${status.kind === 'error' ? 'alert' : 'status'}>${status.text}</span>`}
      </div>
    </form>
  </section>`;
}
