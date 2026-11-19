// Privacy notice (GDPR Article 14): the same statements as PRIVACY.md in the repository.

import { html } from 'htm/preact';
import { Page } from '../layout.js';

const ISSUES = 'https://github.com/Krivetka/npm-publication-monitor/issues';

export function PrivacyView() {
  const hero = html`<div><h1>Privacy notice</h1><p class="lead">What personal data the monitor processes, why, for how long, and how to object.</p></div>`;
  return html`<${Page} hero=${hero}>
    <section class="prose">
      <h2>What is processed</h2>
      <p>The monitor reads the public npm registry. Its records hold package names, version numbers, publication times and the npm account names of publishers and maintainers. An account name is personal data. An e-mail address from the registry is reduced to its domain before anything is stored; the address itself is not stored, shown or sent to a third party.</p>
      <h2>Purpose and legal basis</h2>
      <p>Early detection of compromised or malicious publications, as a non-commercial research project. The legal basis is legitimate interest, Article 6(1)(f) GDPR: the publisher of a version is the main sign of a stolen account, and no less intrusive data carries it.</p>
      <h2>What an alert means</h2>
      <p>An alert is a signal for review with its evidence. It is not a statement that an account or a package is malicious. Most alerts are false; a verdict of an analyst is shown with the alert.</p>
      <h2>Who sees the data</h2>
      <p>The analysts of this deployment. The dashboard and the API are not open to the public. A demonstration outside the deployment shows account names as pseudonyms.</p>
      <h2>Retention</h2>
      <p>Evidence snapshots of events without an alert are emptied after 30 days. Alerts, their snapshots and the verdicts are deleted six months after the defence of the project. The journal of events holds package names only.</p>
      <h2>Source of the data and notice</h2>
      <p>The data comes from the public registry, not from the persons. Informing each of them would take disproportionate effort, so this public notice is given instead (Article 14(5)(b)).</p>
      <h2>Your rights</h2>
      <p>You can ask what is stored about your account, ask for a correction, and object to the processing (Article 21). After an objection the account goes on an exclusion list: its name is removed from the stored snapshots and is not stored again, unless a confirmed incident gives compelling grounds. Write through the <a href=${ISSUES} rel="noopener">issue tracker of the project</a>; do not put private data into a public issue, the operator will answer and give a private channel. You can also complain to a data-protection authority.</p>
    </section>
  </${Page}>`;
}
