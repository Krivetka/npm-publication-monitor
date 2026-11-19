# Stakeholders

## Stakeholder analysis

Table: Stakeholders, their interest and influence

| Stakeholder | Interest | Influence | Involvement |
|---|---|---|---|
| Committee, independent reviewer | working system, honest evaluation | high | this document, the dashboard, the demo |
| Supervisor | scope and method fit a diploma project | high | approves deviations |
| Security engineer (primary user) | early warning with evidence to act on | medium | reads alerts, records verdicts |
| Package maintainer | signal that their package was published unexpectedly | low | searches, reads version history |
| Researcher / operator (the author) | recorded background, reproducible scenarios | high | replays, calibrates |
| External data providers | fair use within rate limits | medium | passive; protected by the quota layer |

Influence/interest matrix: manage closely — committee, supervisor, researcher; keep informed — security engineers; keep satisfied — data providers.

## Personas

**Marta, application security engineer** at a 40-person company with 1 900 packages in the lock file, wants a feed of publications that look wrong and enough evidence to decide in five minutes.

**Ilya, maintainer** of a library with 300 k weekly downloads published through GitHub Actions, wants to be told that a human account published after months of CI-only releases.

**The author, as researcher**, needs the recorded stream as a benign background and a deterministic engine so that a replay reproduces production.
