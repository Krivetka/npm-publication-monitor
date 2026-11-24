# Privacy notice

This notice is given under Article 14 of the GDPR. The dashboard shows the same text at
`/npm/privacy`.

## What is processed

The monitor reads the public npm registry. Its records hold package names, version numbers,
publication times and the npm account names of publishers and maintainers. An account name is
personal data. An e-mail address from the registry is reduced to its domain before anything is
stored; the address itself is not stored, shown or sent to a third party.

## Purpose and legal basis

Early detection of compromised or malicious publications, as a non-commercial research project.
The legal basis is legitimate interest, Article 6(1)(f): the publisher of a version is the main
sign of a stolen account, and no less intrusive data carries it.

## What an alert means

An alert is a signal for review with its evidence. It is not a statement that an account or a
package is malicious. Most alerts are false; a verdict of an analyst is shown with the alert.

## Who sees the data

The analysts of the deployment. The dashboard and the API are not open to the public. A
demonstration outside the deployment shows account names as pseudonyms (role `npm_monitor_read`).

## Retention

- Evidence snapshots of events without an alert are emptied after 30 days.
- Alerts, their snapshots and the verdicts are deleted six months after the defence of the project.
- The journal of events holds package names only.

The database applies these periods itself: function `apply_retention`, run daily by the
`maintenance` service (see the database documentation on the main branch of the repository).

## Source of the data

The data comes from the public registry, not from the persons. Informing each of them would
take disproportionate effort, so this public notice is given instead (Article 14(5)(b)).

## Your rights

You can ask what is stored about your account, ask for a correction, and object to the
processing (Article 21). After an objection the account goes on an exclusion list (table
`exclusion`): its name is removed from the stored snapshots and is not stored again, unless a
confirmed incident gives compelling grounds.

Write through the issue tracker of the repository. Do not put private data into a public issue:
the operator will answer and give a private channel. You can also complain to a
data-protection authority.
