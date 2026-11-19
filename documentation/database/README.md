# Database of the npm Publication Monitor

Category: **transactional relational database (OLTP)**, PostgreSQL 18.

This document describes the database part of the project against the requirements of the programme. The files next to it:

| File | Content |
|---|---|
| [`data-dictionary.md`](data-dictionary.md) | every table, column, key, constraint, index, trigger, view and function; generated from the database |
| [`logical-schema.svg`](logical-schema.svg) | logical schema, colour = block |
| [`schema.sql`](schema.sql) | DDL script of the whole structure in one file |
| `migrations/*.sql` | the same structure as versioned migrations (source of truth) |
| `db/seed/test-data.sql` | test data |
| `deploy/db-roles.sql` | roles |
| `test/db.test.ts` | 38 integration tests of the database |

## 1. Role of the database and choice of the DBMS

The database is the core of the system, not a helper store. The six processes of the pipeline do not call each other. Each process reads rows that the previous one committed, and writes its results and its position in one transaction. The journal of registry events is the work queue, the evidence store and the benign background of the evaluation at the same time.

PostgreSQL 18 was chosen for four reasons:

1. **Transactions across queue and results.** The cursor of a stage and the results of a batch must change together. One ACID store gives exactly-once processing without a message broker.
2. **Declarative range partitioning.** The journal grows by about 99 000 rows a day. Monthly partitions keep indexes small and let a time filter read one or two partitions.
3. **JSONB with indexes** for the two values that have no fixed shape (Section 5), in the same transactional store as the relational data.
4. **LISTEN/NOTIFY.** A commit wakes the next stage and the dashboard; no polling delay, no extra service.

**One DBMS is enough, and this is a decision.** The analytical load is small: the dashboard needs counts per hour and per day over a few million rows, and the largest report takes about five seconds, so it is materialised (Section 10). A column store such as ClickHouse would add a second system, a copy pipeline and a second failure mode for a workload that PostgreSQL serves from two small counter tables and one materialised view. A document store was rejected for the snapshots: they must be written in the same transaction as the score they explain.

## 2. Data layers

The data flows in one direction through three layers. A table belongs to exactly one layer; the colour in the logical schema shows it.

| Layer | Tables | Written by | Purpose |
|---|---|---|---|
| **Raw** | `feed_event`, `collector_state`, `popular_package` | collector, popular | what the outside world said, unchanged and append-only |
| **Processing** | `stage1_result`, `stage2_result`, `maintainer_set`, `rdap_cache`, `stage_cursor` | stage 1, stage 2 | what the engines derived from the raw layer; each row names the engine version that produced it |
| **Mart** | `stage1_hourly`, `source_usage`, `daily_stats` | stage 1, stage 2, maintenance | counters and totals for the dashboard and the KPIs |
| Analyst | `finding`, `finding_history` | API | verdicts: the ground truth of the evaluation |
| Reference | `source`, `feature` | migrations | fixed data |
| Privacy and operations | `exclusion`, `retention_run`, `schema_migrations` | operator, maintenance, migrations | exclusion list, retention log, schema version |

The raw layer is never updated. The processing layer can be rebuilt from it: the stage-1 engine is deterministic, so a new set of parameters is evaluated by a replay of the journal, and the `engine` column tells which rows came from which version.

## 3. Logical schema

![Logical schema](logical-schema.svg)

The schema has 17 tables, 6 views, 1 materialised view, 14 functions and 6 triggers.

| Relationship | Type | How it is kept |
|---|---|---|
| `feed_event` → `stage1_result` | one to zero-or-one | composite foreign key `(seq, event_time)` → `(seq, observed_at)` into the partitioned journal |
| `stage1_result` → `stage2_result` | one to zero-or-one | composite foreign key `(seq, event_time)`; a stage-2 result exists only for a stage-1 candidate |
| `stage2_result` → `maintainer_set` | one to many | foreign key `seq`, `ON DELETE CASCADE`: a history row goes away with its snapshot |
| `feed_event` → `finding` | one to zero-or-one | composite foreign key `(seq, observed_at)`; any event can get a verdict, also one that the pipeline missed |
| `source` → `source_usage` | one to many | foreign key `source` |
| `feature` ↔ results | many to many | the feature ids inside the JSON lists are checked by trigger `features_check`; view `feature_hit` is the junction table |
| `finding` → `finding_history` | one to many, history | trigger `finding_audit`; no foreign key, because the history must outlive a deleted verdict |
| `package` (name) → `feed_event`, `maintainer_set` | one to many | natural key; see Section 4 |

## 4. Normalisation

The schema is in third normal form: in every table each non-key column depends on the whole key and on nothing else. There are four deliberate exceptions. Each one is listed with its reason and with the mechanism that keeps it correct.

| Exception | Reason | Guard |
|---|---|---|
| `stage1_result.event_time`, `stage2_result.event_time`, `finding.observed_at` copy `feed_event.observed_at` | the primary key of a partitioned table must contain the partition column, so a foreign key into the journal needs it | the copy is part of the foreign key; a different value is rejected |
| `stage1_result.package`, `stage2_result.package` copy `feed_event.package` | the alert list and the package page filter and sort by package; without the copy each of them joins the partitioned journal | view `data_quality` counts rows where the copies differ; the result is 0 on 3.17 million events |
| `stage2_result.prescore` repeats `stage1_result.prescore` | it is a historical value: stage 1 can be recomputed with new parameters, the stage-2 row must keep the score it was computed from | documented as history, not as a copy |
| array columns `versions`, `maintainers`, `added`, `removed` | each is one value of the domain (an ordered version list, a set snapshot); it is written and read whole and never joined | view `maintainer_change` gives the first-normal-form shape for queries |

There is no `package` table. A package has no attributes of its own in this system: its name is the complete natural key, and about 8 000 events a day are the first revision of a new package (feature `new_package`). A surrogate key would add one insert and one join per event and would protect nothing.

## 5. JSON columns

Three columns hold JSONB. The rule of the programme is that JSON in a relational database needs a designed model, so each column is described here and guarded in the database.

**`stage1_result.features`, `stage2_result.features`** — the fired features, an array of objects:

```json
[{"id": "publisher_new", "lane": "publisher", "weight": 3, "value": "…", "detail": {"versions": ["1.2.3"]}}]
```

`id`, `lane` and `weight` are always present. `value` and `detail` differ per feature: a number of events for a burst, a list of script names for an install script, a pair of versions for a version jump. A child table would need one nullable column per kind of value, or a second JSON column, and the list is always read whole, with its event. The guards:

- `CHECK`: the value is an array; for stage 1 it is not empty.
- Trigger `features_check`: every element is an object with a string `id` and a numeric `weight`, and the `id` is a row of `feature` for the same stage. This is the foreign key of a child table, written as a trigger.
- View `feature_hit`: one row per fired feature, for joins and counts.
- GIN index (`jsonb_path_ops`) for the filter "events with feature X".

**`stage2_result.evidence`** — the snapshot of the metadata that explains the score: an object with one key per source (`registry`, `ecosystems_package`, `ecosystems_publisher`, `depsdev`, `github_commit`, `rdap`). The `registry` part holds the published versions with publisher, maintainers, scripts, dependencies, sizes and provenance; the version before the event; the publication history. It is a copy of documents that external services own and change without notice, so its shape cannot be fixed by this project. It is written once and shown whole on the event card. No query filters by its content. The guards: `CHECK` that it is an object; trigger `stage2_result_privacy` (Section 11).

**`stage2_result.sources`** — what was asked of each source: an object keyed by source with the HTTP status or the reason a request was skipped, and `repeat_of` for a repeated alert. A diagnostic record, read whole. `CHECK`: an object.

Everything that a query filters, sorts or aggregates by is a typed column: scores, the alert flag, the kind of event, times, versions.

## 6. Data integrity

The database rejects wrong data by itself; the application does not have to be correct for the data to be consistent.

| Mechanism | Count | Examples |
|---|---|---|
| Primary keys | 17 | every table has one; composite where the natural key is composite (`popular_package (snapshot, name)`, `source_usage (hour, source)`) |
| Foreign keys | 5 | Section 3; two of them composite into partitioned or keyed-by-time tables |
| Unique constraints | 2 | `popular_package (snapshot, rank)`, `stage1_result (seq, event_time)` |
| NOT NULL | 84 columns | a column is nullable only when "unknown" is a real state (`observed_after`, `downloads`, `note`) |
| CHECK | 30 | value sets (`kind`, `verdict`, `operation`), ranges (scores ≥ 0, counters ≥ 0, `flagged ≤ processed`), formats (`rev`, engine tag, account name, lower-case domain), order of times (`observed_after ≤ observed_at`), JSON types |
| Triggers | 6 | feature lists, audit of verdicts, e-mail minimisation, exclusion list |

Types are chosen by meaning: `timestamptz` for every moment (never text or local time), `bigint` for feed positions, `date` for a snapshot day, `boolean` for flags, `real` for scores, `text[]` for ordered lists, `jsonb` only as in Section 5.

One constraint came from a test, not from the design: `feed_event.observed_at` must have millisecond precision. The application reads times with millisecond precision and writes them back into the foreign keys; a microsecond value in the journal could never be matched again.

View **`data_quality`** states the expectations that a constraint cannot express and counts the rows that break each one. On the production copy all seven counts are zero after the first retention run.

## 7. Transactions

Every unit of work is one transaction. If any statement fails, nothing of the unit stays. The isolation level is the PostgreSQL default, READ COMMITTED. It is enough because the stages do not compete for rows — each one writes its own tables behind its own cursor — and every write of the pipeline is idempotent (`ON CONFLICT`).

| Unit of work | What commits together | Effect |
|---|---|---|
| Collector page | the events of the page, the new feed position, `NOTIFY feed` | after a crash the collector continues from the last committed position: no event lost, no event twice (a repeated `seq` is skipped) |
| Stage-1 batch | result rows, hourly counters, the stage cursor, `NOTIFY stage1` | exactly-once processing; counters never count a batch twice |
| Stage-2 result | the result with its snapshot, request counters, the maintainer-set change, `NOTIFY stage2` | an alert never exists without its evidence |
| Popular snapshot | delete of today's rows, insert of 10 000 rows, removal of old snapshots | readers see the old list or the new one, never a half |
| Migration | all statements of the file and its row in `schema_migrations` | a failed migration leaves no trace |
| Retention run | all deletions and the row in `retention_run` | the log always matches what was removed |
| Verdict | the verdict and its history row (trigger) | the audit trail has no gaps |

`NOTIFY` is sent inside the transaction, so listeners hear about rows only after they are visible.

The integration tests prove the rollbacks, not only the happy path: a page with one bad row leaves no event and does not move the cursor; a stage-1 batch with an unknown feature leaves the cursor and the counters unchanged; a stage-2 result with a wrong source leaves no row and no counter.

## 8. Indexes

Every index serves a named query. The plans were measured on a copy of the production data (3.17 million events, 78 000 stage-2 results).

| Index | Serves | Measured |
|---|---|---|
| `feed_event (seq, observed_at)` — primary key, per partition | stage 1 reads the journal in `seq` order from its cursor; foreign keys | next 1 000 events: index scan, 4 ms |
| `feed_event (package, seq)` | history of a package (package page; "previous event" of stage 1) | index-only scan, backward |
| `feed_event (observed_at)` | counts per time range; pruning by partition | 1 day: one partition read, older ones removed from the plan |
| `stage1_result (seq) WHERE candidate` — partial | the stage-2 queue: candidates without a result | index-only scan, 32 ms for the anti-join over all 78 000 candidates |
| `stage1_result (event_time)` | feature frequencies per period | bitmap index scan; 24 h of both stages through `feature_hit`: 12 ms |
| `stage1_result USING gin (features jsonb_path_ops)` | filter "events with feature X" | bitmap index scan |
| `stage2_result (event_time) WHERE alert` — partial | the alert list, newest first | 351 alerts of 7 days in 12 ms; the index is 88 kB for a 587 MB table |
| `stage2_result (package)` | alerts and results of one package; the repeat check before an alert | bitmap index scan, 1.5 ms |
| `stage2_result (event_time)` | counts of enriched events per time range (totals, hourly chart, feature frequencies) | count for 24 h: 12 ms as a sequential scan before the index, 0.13 ms as an index-only scan with it |
| `stage2_result USING gin (features jsonb_path_ops)` | filter by stage-2 feature | 47 rows in 4 ms |
| `finding_history (seq, changed_at)` | history of one verdict | bitmap index scan |
| `daily_stats (day)` — unique | lets the view refresh without blocking readers | — |

Two design rules: an index on the journal exists on every partition, so its size follows the month, not the whole history; and a partial index is used where a query reads a small, fixed part of a table (alerts are 2 % of the stage-2 rows, candidates 10 % of the stage-1 rows).

No index was added "to be safe". `stage2_result.final_score` has none: the only query by score reads alerts, which the partial index already narrows to a few hundred rows. The index on `stage2_result (event_time)` was added only after the plan of the feature-frequency query showed a sequential scan.

## 9. Business logic in the database

Rules that must hold for every client live in the database as functions and triggers, not only in the application.

| Object | Kind | Rule |
|---|---|---|
| `feed_event_ensure_partitions()` | function, owner rights | creates the partitions of the current and the next month. The pipeline role cannot create tables; the function is the one controlled way to do it |
| `features_check` | trigger | a feature list can hold only catalogue features of the right stage (Section 5) |
| `finding_audit` | trigger, owner rights | every change of a verdict is copied to `finding_history` with the role that made it. The history table is writable by nobody else |
| `stage2_result_privacy` | trigger | e-mail addresses in a snapshot are reduced to the domain; excluded accounts are removed |
| `maintainer_set_privacy` | trigger | excluded accounts are removed from maintainer sets |
| `exclusion_apply` | trigger, owner rights | a new exclusion cleans all stored rows, except those of an event with the verdict *confirmed* |
| `apply_retention()` | function, owner rights | the retention periods (Section 11); every run is logged |
| `refresh_daily_stats()` | function, owner rights | refreshes the materialised view without blocking readers |
| `grant_app_privileges()` | function | re-applies the access rights to all objects (Section 12) |
| `mask_email()`, `pseudonym()`, `evidence_minimise()`, `account_redact()`, `array_redact()` | functions | masking and redaction (Section 11) |

The scoring engines themselves stay in the application: they keep sliding windows in memory and are tested and replayed as pure functions. The database owns the rules about what may be stored, for how long and by whom.

## 10. Views

| View | Purpose | Used by |
|---|---|---|
| `feature_hit` | one row per fired feature: the relational form of the JSON lists | the feature-frequency queries of the API and the dashboard |
| `maintainer_change` | one row per added or removed account | reports on maintainer changes |
| `alert` | alerts with both scores, feature ids and the current verdict | the analyst's work list in SQL, the evaluation |
| `stage2_result_masked`, `maintainer_set_masked` | the tables with personal data, masked | the read role, demonstrations |
| `data_quality` | expectations and the number of violations | operator, tests |
| `daily_stats` (materialised) | totals per day: events, packages, flagged, candidates, enriched, alerts, alerts on popular packages, verdicts | KPI-5 (alerts per day), precision estimate |

`daily_stats` is materialised because it reads the whole journal: about five seconds on 3.17 million events. The maintenance process refreshes it once a day with `REFRESH … CONCURRENTLY`, which needs the unique index and does not block readers. The dashboard's hourly charts do not need it: they read the counter tables `stage1_hourly` and `source_usage`, which the stages keep up to date inside their own transactions.

## 11. Personal data

The registry publishes account names and e-mail addresses with every version. The system needs the account name (who published) and only the **domain** of the address (its age is a feature). The database enforces this.

| Measure | Implementation |
|---|---|
| **Minimisation** | trigger `stage2_result_privacy` rewrites every `{"email": "jane@example.org"}` in a snapshot to `{"emailDomain": "example.org"}` before the row is stored. Migration 009 did the same for the 57 000 snapshots stored before. `rdap_cache` holds domains only. View `data_quality` counts snapshots with an address: 0 |
| **Masking** | `mask_email('jane@example.org')` → `j***@example.org`; `pseudonym('jane')` → `user-` and ten hex digits of SHA-256, the same for the same account. The masked views replace account names by pseudonyms and leave the snapshots out |
| **Access** | the read role can select the masked views only; it gets "permission denied" on `stage2_result`, `maintainer_set` and `exclusion` (Section 12) |
| **Right to object** | a row in `exclusion` removes the account from all stored snapshots and maintainer sets and from every later row. An event with the verdict *confirmed* keeps its data (GDPR Article 21(1), compelling grounds) |
| **Retention** | `apply_retention(30, date)`: the snapshot of a candidate without an alert is emptied 30 days after enrichment; the row keeps its score and feature ids for the statistics. Maintainer-set rows of such snapshots are deleted, except the newest one of a package, which stage 2 needs as the baseline. After the final date (six months after the defence) the snapshots of alerts, the maintainer history and the verdicts are removed too. Every run writes a row to `retention_run` |

The system has no user accounts and stores no passwords. The one credential of the application, the analyst token, lives in the server environment and never in the database or the repository.

## 12. Roles and access rights

| Role | Used by | Rights |
|---|---|---|
| `npm_monitor` | the migration service only | owner of all objects |
| `npm_monitor_write` | collector, popular, stage 1, stage 2, maintenance | SELECT on all tables; INSERT, UPDATE, DELETE on the pipeline tables; EXECUTE on the three maintenance functions. No access to verdicts or the audit trail; cannot create or drop objects |
| `npm_monitor_web` | API and dashboard | SELECT on everything; INSERT, UPDATE, DELETE on `finding` only |
| `npm_monitor_read` | reports, demonstrations | SELECT on tables without personal data and on the masked views |

- **No process runs as a superuser.** The three application roles are created with `NOSUPERUSER NOCREATEDB NOCREATEROLE`; a test checks the flags in `pg_roles`.
- **Least privilege by owner-rights functions.** Creating a partition, refreshing the materialised view, writing the audit trail and deleting verdicts after the final date need rights that the calling role does not have. Each of these is one `SECURITY DEFINER` function with a fixed `search_path`, so the role can do exactly that action and nothing else.
- **New objects get their rights automatically.** The grants are one function, `grant_app_privileges()`. The migration service calls it after every run. A test adds a table, shows that the web role cannot read it, runs the migration service and shows that it can.
- **Passwords.** Role passwords are stored by PostgreSQL as SCRAM-SHA-256 verifiers; `deploy/db-roles.sql` refuses to run under another `password_encryption`. MD5 is not used anywhere. Connection strings are in the server's `.env`, never in Git.
- `PUBLIC` cannot connect to the database or create objects in the schema; the read and web roles have a statement timeout.

## 13. Versioning and deployment

The structure is never changed by hand.

- **Migrations.** `migrations/NNN_name.sql`, applied in file-name order by `src/db/migrate.ts`. Each file runs in one transaction together with its row in `schema_migrations`. A file that was deployed is never edited; a change is a new file.
- **History.** Git holds the text and the author of every migration; `schema_migrations` holds what each database has and when it got it.
- **Deployment.** The migration service is the first container to start; the other processes wait until it has finished. After the migrations it writes the feature catalogue from the code (`src/db/reference.ts`) and re-applies the access rights.
- **Rehearsal.** Migrations 006–010 were first run on a copy of the production database: 1 min 31 s for 3.17 million events, of which 80 s is the rewrite of the stored snapshots. The rehearsal found one constraint that real rows did not satisfy (the format of the stage-1 engine tag); it was corrected before any production run.

| Migration | Content |
|---|---|
| 001–003 | journal, stage 1, stage 2 |
| 004 | monthly partitioning of the journal, with the data moved in one transaction |
| 005 | verdicts, maintainer-set history, GIN indexes |
| 006 | reference tables, foreign keys, CHECK constraints |
| 007 | functions and triggers: partitions, feature lists, audit, privacy, retention |
| 008 | views and the materialised view |
| 009 | removal of e-mail addresses from stored snapshots |
| 010 | access rights |
| 011 | the data dictionary as `COMMENT ON` |

## 14. Test data

- **Reference tables.** `source` is filled by migration 006. `feature` is filled by `npm run db:reference` from the code catalogue (47 features); the migration service runs it on every start.
- **Test records.** `npm run db:seed` loads `db/seed/test-data.sql`: 15 events that cover every state of an event — no feature, flagged, queued candidate, enriched, alert with each verdict, repeat of an alert, missing package, failed enrichment — and the edge cases: an event without a lower time bound, a deleted package, a scoped name, a row 40 days old for the retention rule, a snapshot with e-mail addresses, a script text that only looks like an e-mail field.
- **Tests.** `test/db.test.ts` builds its own database, runs the migrations, loads the test data and runs 38 tests: constraints and foreign keys, rollbacks of each unit of work, partitions, privacy rules, retention, the audit trail, views, and the rights of each role.

```sh
docker compose -f compose.dev.yml up -d --wait
npm run migrate && npm run db:seed
TEST_DATABASE_URL=postgres://npm_monitor:dev@127.0.0.1:55432/npm_monitor npm test
```

## 15. Volumes and backups

Measured after 32 days of continuous operation (3.17 million events, 1.58 GB in total):

| Table | Rows per day | Size per month, with indexes | Kept |
|---|---|---|---|
| `feed_event` | ≈ 99 000 | ≈ 0.65 GB | whole observation period; a month is one partition |
| `stage1_result` | ≈ 23 000 | ≈ 0.26 GB | whole period |
| `stage2_result` | ≈ 2 400 | ≈ 0.55 GB before retention | snapshots without an alert: 30 days; rows: whole period |
| `maintainer_set` | ≈ 650 | ≈ 6 MB | with its snapshot |
| all other tables | — | < 15 MB together | — |

A snapshot is 6.9 kB on average, so `stage2_result` holds 2 % of the rows and 37 % of the bytes. The retention rule keeps it from growing without limit: only the snapshots of the last 30 days and of alerts stay.

The host makes a compressed dump of the database every night and keeps the last 15.

## 16. Requirements checklist

**Minimum**

| Requirement | Where |
|---|---|
| Data dictionary: layers, tables, columns, types, keys, quality expectations | `data-dictionary.md`; Sections 2, 6; view `data_quality` |
| Data integrity and transactions | Sections 6, 7 |
| Logical schema, blocks highlighted | `logical-schema.svg`, Section 3 |
| DDL script | `schema.sql`; `migrations/` |
| Modern relational DBMS | PostgreSQL 18 |
| Normalisation to 3NF | Section 4 |
| Enough tables, different relationship types | 17 tables; Section 3 |
| Keys, constraints, meaningful types | Section 6 |
| Structure from scripts or migrations, in Git | Section 13 |
| Test records, edge cases | Section 14 |
| Scripts for reference tables | migration 006, `npm run db:reference` |
| Roles; no superuser; rights for new objects | Section 12 |
| Passwords only encrypted, no MD5 or SHA-1 | Section 12 |
| No JSON without a designed model | Section 5 |

**Maximum**

| Requirement | Where |
|---|---|
| Several DBMS when justified | one DBMS, with the reasoning: Section 1 |
| Data layers | Section 2 |
| Versioning of the structure | Section 13 |
| Indexes, justified | Section 8 |
| Triggers, stored procedures, functions with business logic | Section 9 |
| Views, materialised views | Section 10 |
| Masking or anonymisation of personal data | Section 11 |
