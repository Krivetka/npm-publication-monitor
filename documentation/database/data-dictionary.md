# Data dictionary

Generated from the database catalogue by `scripts/db-docs.mjs`; the descriptions are the `COMMENT ON` texts of migration `011_comments.sql`. Do not edit by hand.

Notation: **PK** primary key, **FK → t** foreign key to table *t*, **UQ** unique. A column is NOT NULL unless the column "Null" says *yes*. The monthly partitions of `feed_event` (`feed_event_YYYYMM`, `feed_event_default`) have the columns of the parent and are not listed.

The schema has 17 tables, 6 views, 1 materialised view, 14 functions and 6 triggers.

## Raw layer: journal and inputs

### feed_event

*table, partitioned by RANGE (observed_at).* Raw layer. Journal of the npm registry change feed: one row per change of a package document. It is the work queue of the pipeline and the benign background of the evaluation. Append-only; partitioned by month on observed_at.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `seq` | bigint |  | PK | Position of the change in the registry feed. Unique over the whole journal; grows with time; gaps are normal. |
| `package` | text |  |  | Package name as the registry gives it, with the scope if there is one (for example @scope/name). Never empty. |
| `rev` | text |  |  | Revision of the package document, "<number>-<hash>". The number grows by one with every change of the document. |
| `deleted` | boolean, default `false` |  |  | True when the change is the deletion of the package document. |
| `observed_at` | timestamptz |  | PK | When the collector received the page with this event. Millisecond precision. Partition key; upper bound of the time the event appeared. |
| `observed_after` | timestamptz | yes |  | Lower bound of the time the event appeared: the previous poll that drained the feed. Null for history loaded from a start position. Never later than observed_at. |

Constraints:

- `feed_event_interval_check`: `CHECK (((observed_after IS NULL) OR (observed_after <= observed_at)))`
- `feed_event_package_check`: `CHECK ((package <> ''::text))`
- `feed_event_precision_check`: `CHECK ((observed_at = date_trunc('milliseconds'::text, observed_at)))`
- `feed_event_rev_check`: `CHECK ((rev ~ '^[0-9]+-'::text))`
- `feed_event_seq_check`: `CHECK ((seq > 0))`
- `feed_event_pkey`: `PRIMARY KEY (seq, observed_at)`

Indexes (besides the keys):

- `feed_event_observed_at_idx`: `feed_event USING btree (observed_at)`
- `feed_event_package_idx`: `feed_event USING btree (package, seq)`

### collector_state

*table.* Read position of the collector, one row per feed. Updated in the same transaction as the events of a page, so a restart continues exactly where the last commit ended.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `feed` | text |  | PK | Name of the feed; the system reads one feed, "npm". |
| `last_seq` | bigint |  |  | Last feed position stored in the journal. |
| `window_start` | timestamptz | yes |  | Lower time bound (observed_after) for the events of the next page. |
| `head_seq` | bigint | yes |  | Head position of the registry feed at the last check; head_seq - last_seq is the lag. |
| `polled_at` | timestamptz |  |  | Last successful poll. The health check fails when it is older than five minutes. |
| `advanced_at` | timestamptz |  |  | Last time last_seq moved forward. |

Constraints:

- `collector_state_seq_check`: `CHECK (((last_seq >= 0) AND ((head_seq IS NULL) OR (head_seq >= 0))))`

### popular_package

*table.* Daily snapshot of the most downloaded packages: the watchlist and the targets of the name-similarity rules. The seven newest snapshots are kept.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `snapshot` | date |  | PK, UQ | Date of the snapshot (UTC). |
| `rank` | integer |  | UQ | Place in the list, 1 is the most downloaded. Unique in a snapshot. |
| `name` | text |  | PK | Package name. |
| `downloads` | bigint | yes |  | Download count when the source gives one; null otherwise. |

Constraints:

- `popular_package_check`: `CHECK (((rank > 0) AND (name <> ''::text) AND ((downloads IS NULL) OR (downloads >= 0))))`
- `popular_package_pkey`: `PRIMARY KEY (snapshot, name)`
- `popular_package_rank_key`: `UNIQUE (snapshot, rank)`

## Reference data

### source

*table.* Reference table: the five external data sources of stage 2. Fixed data, filled by migration 006.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `id` | text |  | PK | Short name used in the code and in source_usage. |
| `title` | text |  |  | Name for reports. |
| `base_url` | text |  |  | Base address of the service; always https. |

Constraints:

- `source_base_url_check`: `CHECK ((base_url ~~ 'https://%'::text))`

### feature

*table.* Reference table: catalogue of the features (detection rules) the two engines can emit. Filled from the code catalogue after every migration run; the triggers features_check compare stored results with it.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `id` | text |  | PK | Identifier of the feature, lower snake case. |
| `stage` | smallint |  |  | 1 — computed from the journal alone; 2 — computed from enrichment data. |
| `lane` | text |  |  | Group of related features (temporal, nominal, version, publisher, manifest and so on). |
| `weight` | real |  |  | Current weight of the feature in the score. The weight that was applied to an event is stored with the event. |
| `title` | text |  |  | Name for the dashboard and reports. |
| `hint` | text, default `''::text` |  |  | One-sentence explanation for the analyst. |
| `active` | boolean, default `true` |  |  | False when the engines no longer emit the feature; the row stays because stored results refer to it. |
| `updated_at` | timestamptz, default `now()` |  |  | Last change of the row by the reference sync. |

Constraints:

- `feature_id_check`: `CHECK ((id ~ '^[a-z][a-z0-9_]*$'::text))`
- `feature_lane_check`: `CHECK ((lane <> ''::text))`
- `feature_stage_check`: `CHECK ((stage = ANY (ARRAY[1, 2])))`

## Processing layer: stage results

### stage_cursor

*table.* Journal position of each pipeline stage. Written in the same transaction as the results of a batch: every event is processed exactly once.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `stage` | text |  | PK | Name of the stage. |
| `last_seq` | bigint |  |  | Last journal position the stage processed. |
| `processed` | bigint, default `0` |  |  | Number of events processed since the first start. |
| `updated_at` | timestamptz |  |  | Time of the last batch. |

Constraints:

- `stage_cursor_check`: `CHECK (((last_seq >= 0) AND (processed >= 0)))`

### stage1_result

*table.* Processing layer. Result of stage 1 for an event where at least one feature fired (about one event in four). Events without a row scored zero; the engine is deterministic, so they can be recomputed from the journal.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `seq` | bigint |  | FK → feed_event, FK → feed_event_202611, FK → feed_event_202612, FK → feed_event_default, PK, UQ | The event; one result per event. |
| `package` | text |  |  | Copy of feed_event.package. Controlled redundancy: lists and filters by package read this table without a join to the partitioned journal. View data_quality proves the copies are equal. |
| `event_time` | timestamptz |  | FK → feed_event, FK → feed_event_202611, FK → feed_event_202612, FK → feed_event_default, UQ | Copy of feed_event.observed_at; second column of the foreign key to the journal, so the copy cannot differ. |
| `prescore` | real |  |  | Sum of the weights of the fired stage-1 features. Not negative. |
| `candidate` | boolean |  |  | True when the event goes to stage 2: prescore at or above the threshold, or the package is on the watchlist. |
| `features` | jsonb |  |  | Fired features: a JSON array of {id, lane, weight, value, threshold?, detail?}. Never empty. Every id is a stage-1 row of the feature table (trigger features_check). See the section "JSON columns" of the database document. |
| `engine` | text |  |  | Version of the engine that produced the row: "v<version>:<hash of parameters>@<date of the popular-package snapshot or none>". |

Constraints:

- `stage1_result_engine_check`: `CHECK ((engine ~ '^v[0-9]+:[0-9a-f]+@([0-9]{4}-[0-9]{2}-[0-9]{2}\|none)$'::text))`
- `stage1_result_features_check`: `CHECK (((jsonb_typeof(features) = 'array'::text) AND (jsonb_array_length(features) > 0)))`
- `stage1_result_prescore_check`: `CHECK ((prescore >= (0)::double precision))`
- `stage1_result_event_fkey`: `FOREIGN KEY (seq, event_time) REFERENCES feed_event(seq, observed_at)`
- `stage1_result_event_fkey_1`: `FOREIGN KEY (seq, event_time) REFERENCES feed_event_202611(seq, observed_at)`
- `stage1_result_event_fkey_2`: `FOREIGN KEY (seq, event_time) REFERENCES feed_event_202612(seq, observed_at)`
- `stage1_result_event_fkey_3`: `FOREIGN KEY (seq, event_time) REFERENCES feed_event_default(seq, observed_at)`
- `stage1_result_seq_time_key`: `UNIQUE (seq, event_time)`

Indexes (besides the keys):

- `stage1_result_candidate_idx`: `stage1_result USING btree (seq) WHERE candidate`
- `stage1_result_features_idx`: `stage1_result USING gin (features jsonb_path_ops)`
- `stage1_result_time_idx`: `stage1_result USING btree (event_time)`

Triggers:

- `stage1_result_features_check`: BEFORE INSERT OR UPDATE OF features FOR EACH ROW → `features_check('1')`

### stage2_result

*table.* Processing layer. Result of stage 2 for a candidate: enrichment features, the final score, the alert decision and a snapshot of the registry metadata at enrichment time (the registry later removes malicious versions).

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `seq` | bigint |  | FK → stage1_result, PK | The event; one result per candidate. Refers to the stage-1 result. |
| `package` | text |  |  | Copy of feed_event.package (see stage1_result.package). |
| `event_time` | timestamptz |  | FK → stage1_result | Copy of feed_event.observed_at; part of the foreign key to stage1_result. |
| `enriched_at` | timestamptz |  |  | When stage 2 stored the result. The retention period counts from this time. |
| `kind` | text |  |  | publish — the event carries new versions; metadata — no new version (tags, maintainers); package_missing — the registry no longer has the package; error — the package document could not be read. |
| `versions` | text[] |  |  | Versions published by the event, in publication order. Empty for the other kinds. Read and written as one value, never joined. |
| `prescore` | real |  |  | Stage-1 score at enrichment time. A historical value: stage 1 can be recomputed later with new parameters. |
| `final_score` | real |  |  | prescore plus the weights of the stage-2 features. Not negative. |
| `alert` | boolean |  |  | True when the event raised an alert for the analyst. |
| `features` | jsonb |  |  | Fired stage-2 features: JSON array of {id, lane, weight, value, detail?}; may be empty. Every id is a stage-2 row of the feature table. |
| `evidence` | jsonb |  |  | Snapshot of the metadata that explains the score: a JSON object with one key per source (registry, ecosystems_package, ecosystems_publisher, depsdev, github_commit, rdap). Personal data: account names. E-mail addresses are reduced to the domain by trigger. Emptied by the retention job. |
| `sources` | jsonb |  |  | What was asked of each source and what was skipped by quota: a JSON object keyed by source; repeat_of holds the seq of the alert this event repeats. |
| `engine` | text |  |  | Version of the stage-2 engine: "v<version>:<hash of parameters>". |
| `evidence_purged_at` | timestamptz | yes |  | When the retention job removed the snapshot; null while the snapshot is present. |

Constraints:

- `stage2_result_engine_check`: `CHECK ((engine ~ '^v[0-9]+:[0-9a-f]+$'::text))`
- `stage2_result_json_check`: `CHECK (((jsonb_typeof(features) = 'array'::text) AND (jsonb_typeof(evidence) = 'object'::text) AND (jsonb_typeof(sources) = 'object'::text)))`
- `stage2_result_kind_check`: `CHECK ((kind = ANY (ARRAY['publish'::text, 'metadata'::text, 'package_missing'::text, 'error'::text])))`
- `stage2_result_score_check`: `CHECK (((prescore >= (0)::double precision) AND (final_score >= (0)::double precision)))`
- `stage2_result_stage1_fkey`: `FOREIGN KEY (seq, event_time) REFERENCES stage1_result(seq, event_time)`

Indexes (besides the keys):

- `stage2_result_alert_idx`: `stage2_result USING btree (event_time) WHERE alert`
- `stage2_result_features_idx`: `stage2_result USING gin (features jsonb_path_ops)`
- `stage2_result_package_idx`: `stage2_result USING btree (package)`
- `stage2_result_time_idx`: `stage2_result USING btree (event_time)`

Triggers:

- `stage2_result_features_check`: BEFORE INSERT OR UPDATE OF features FOR EACH ROW → `features_check('2')`
- `stage2_result_privacy`: BEFORE INSERT OR UPDATE OF evidence FOR EACH ROW → `stage2_result_privacy()`

### maintainer_set

*table.* History of the maintainer set of a package: one row per observed change. Personal data: account names. A row belongs to the stage-2 snapshot it was read from and is deleted with it.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `package` | text |  | PK | Package name. |
| `seq` | bigint |  | FK → stage2_result, PK | The event whose snapshot showed the change. |
| `observed_at` | timestamptz |  |  | Time of that event. |
| `maintainers` | text[] |  |  | Complete set after the change, sorted. Stored as one value: the set is a snapshot, compared as a whole. |
| `added` | text[], default `'{}'::text[]` |  |  | Accounts that were not in the previous row. View maintainer_change gives one row per account. |
| `removed` | text[], default `'{}'::text[]` |  |  | Accounts that were in the previous row and are gone. |

Constraints:

- `maintainer_set_package_check`: `CHECK ((package <> ''::text))`
- `maintainer_set_stage2_fkey`: `FOREIGN KEY (seq) REFERENCES stage2_result(seq) ON DELETE CASCADE`
- `maintainer_set_pkey`: `PRIMARY KEY (package, seq)`

Triggers:

- `maintainer_set_privacy`: BEFORE INSERT OR UPDATE FOR EACH ROW → `maintainer_set_privacy()`

### rdap_cache

*table.* Cache of domain registration data for publisher e-mail domains. Holds the domain only, never an address. An entry is used for 30 days.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `domain` | text |  | PK | Domain name, lower case. |
| `fetched_at` | timestamptz |  |  | When the answer was received. |
| `status` | integer |  |  | HTTP status of the answer (200, 404 and so on). |
| `registered` | timestamptz | yes |  | Registration date of the domain, when known. |
| `expires` | timestamptz | yes |  | Expiry date of the domain, when known. |

Constraints:

- `rdap_cache_domain_check`: `CHECK (((domain = lower(domain)) AND (domain ~~ '%.%'::text)))`
- `rdap_cache_status_check`: `CHECK (((status >= 0) AND (status <= 599)))`

## Mart layer: counters and totals

### stage1_hourly

*table.* Mart layer. Hourly counters of stage 1: the denominator of the filtering evaluation. Updated in the transaction of each batch.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `hour` | timestamptz |  | PK | Start of the hour (UTC). |
| `processed` | integer |  |  | Events processed in the hour. |
| `flagged` | integer |  |  | Events with at least one fired feature. Not more than processed. |
| `candidates` | integer |  |  | Events passed to stage 2. Not more than flagged. |

Constraints:

- `stage1_hourly_check`: `CHECK (((processed >= 0) AND (flagged >= 0) AND (candidates >= 0) AND (flagged <= processed) AND (candidates <= flagged)))`
- `stage1_hourly_hour_check`: `CHECK ((hour = (date_trunc('hour'::text, (hour AT TIME ZONE 'UTC'::text)) AT TIME ZONE 'UTC'::text)))`

### source_usage

*table.* Mart layer. Requests to the external sources per hour: proof that the quotas hold and the denominator of the cost evaluation.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `hour` | timestamptz |  | PK | Start of the hour (UTC). |
| `source` | text |  | FK → source, PK | The source. |
| `requests` | integer |  |  | Requests sent. |
| `errors` | integer |  |  | Requests that failed. |
| `skipped` | integer |  |  | Requests not sent because the hourly budget was used up. |

Constraints:

- `source_usage_check`: `CHECK (((requests >= 0) AND (errors >= 0) AND (skipped >= 0)))`
- `source_usage_source_fkey`: `FOREIGN KEY (source) REFERENCES source(id)`
- `source_usage_pkey`: `PRIMARY KEY (hour, source)`

### daily_stats

*materialised view.* Mart layer. Totals per day (UTC): events, packages, flagged, candidates, enriched, alerts, alerts on popular packages, verdicts. Source of KPI-5. Refreshed daily by refresh_daily_stats().

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `day` | date | yes |  |  |
| `events` | integer | yes |  |  |
| `packages` | integer | yes |  |  |
| `flagged` | integer | yes |  |  |
| `candidates` | integer | yes |  |  |
| `enriched` | integer | yes |  |  |
| `alerts` | integer | yes |  |  |
| `alerts_popular` | integer | yes |  |  |
| `confirmed` | integer | yes |  |  |
| `false_positive` | integer | yes |  |  |

Indexes (besides the keys):

- `daily_stats_day_key`: `UNIQUE daily_stats USING btree (day)`

## Analyst layer: verdicts

### finding

*table.* Current verdict of the analyst for an event: the ground truth of the evaluation. One verdict per event; any journal event can get one, also an event the pipeline missed.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `seq` | bigint |  | FK → feed_event, FK → feed_event_202611, FK → feed_event_202612, FK → feed_event_default, PK | The event. |
| `verdict` | text |  |  | confirmed — a real incident; false_positive — a benign publication; undecided — looked at, no decision yet. |
| `note` | text | yes |  | Free text of the analyst. |
| `reference` | text | yes |  | Advisory, issue or write-up that confirms the verdict. |
| `decided_at` | timestamptz |  |  | Time of the last change. |
| `observed_at` | timestamptz |  | FK → feed_event, FK → feed_event_202611, FK → feed_event_202612, FK → feed_event_default | Copy of feed_event.observed_at; second column of the foreign key to the journal. |

Constraints:

- `finding_reference_check`: `CHECK (((reference IS NULL) OR (reference <> ''::text)))`
- `finding_verdict_check`: `CHECK ((verdict = ANY (ARRAY['confirmed'::text, 'false_positive'::text, 'undecided'::text])))`
- `finding_event_fkey`: `FOREIGN KEY (seq, observed_at) REFERENCES feed_event(seq, observed_at)`
- `finding_event_fkey_1`: `FOREIGN KEY (seq, observed_at) REFERENCES feed_event_202611(seq, observed_at)`
- `finding_event_fkey_2`: `FOREIGN KEY (seq, observed_at) REFERENCES feed_event_202612(seq, observed_at)`
- `finding_event_fkey_3`: `FOREIGN KEY (seq, observed_at) REFERENCES feed_event_default(seq, observed_at)`

Triggers:

- `finding_audit`: AFTER INSERT OR DELETE OR UPDATE FOR EACH ROW → `finding_audit()`

### finding_history

*table.* Audit trail of finding: one row per insert, change or deletion, written by trigger finding_audit. Nobody but the trigger can write here.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `id` | bigint, default `identity` |  | PK | Surrogate key in order of the changes. |
| `seq` | bigint |  |  | The event. |
| `operation` | text |  |  | insert, update or delete. |
| `verdict` | text | yes |  | Verdict after the change; for delete, the verdict that was removed. |
| `note` | text | yes |  | Note after the change. |
| `reference` | text | yes |  | Reference after the change. |
| `changed_at` | timestamptz, default `now()` |  |  | Time of the change. |
| `changed_by` | text, default `SESSION_USER` |  |  | Database role that made the change. |

Constraints:

- `finding_history_operation_check`: `CHECK ((operation = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])))`
- `finding_history_verdict_check`: `CHECK ((verdict = ANY (ARRAY['confirmed'::text, 'false_positive'::text, 'undecided'::text])))`

Indexes (besides the keys):

- `finding_history_seq_idx`: `finding_history USING btree (seq, changed_at)`

## Privacy and operations

### exclusion

*table.* Accounts that used the right to object (GDPR Article 21). The triggers remove the name from stored rows and from every new row.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `account` | text |  | PK | npm user name. |
| `requested_at` | timestamptz, default `now()` |  |  | When the request was recorded. |
| `note` | text | yes |  | Reference to the request. |

Constraints:

- `exclusion_account_check`: `CHECK ((account ~ '^[A-Za-z0-9][A-Za-z0-9._~-]*$'::text))`

Triggers:

- `exclusion_apply`: AFTER INSERT FOR EACH ROW → `exclusion_apply()`

### retention_run

*table.* Log of the retention job: one row per run with the number of rows it removed.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `ran_at` | timestamptz, default `now()` |  | PK | Start of the run. |
| `evidence_days` | integer |  |  | Retention period that was applied, in days. |
| `delete_all_after` | timestamptz | yes |  | Final date that was applied; null when none was set. |
| `snapshots_purged` | integer |  |  | Snapshots of candidates without an alert that were emptied. |
| `maintainer_rows_purged` | integer |  |  | Maintainer-set rows that were deleted. |
| `alerts_purged` | integer |  |  | Snapshots of alerts emptied after the final date. |
| `findings_purged` | integer |  |  | Verdicts deleted after the final date. |

### schema_migrations

*table.* Version history of the schema: one row per applied migration file.

| Column | Type | Null | Key | Description |
|---|---|---|---|---|
| `name` | text |  | PK | File name in migrations/. |
| `applied_at` | timestamptz, default `now()` |  |  | When the migration was applied to this database. |

## Views

### alert

Alerts with the stage-1 score, the stage-2 feature ids and the current verdict ("open" when there is none).

Columns: `seq` bigint, `package` text, `event_time` timestamptz, `enriched_at` timestamptz, `kind` text, `versions` text[], `stage1_score` real, `final_score` real, `engine` text, `stage2_features` text[], `verdict` text, `reference` text, `decided_at` timestamptz.

### data_quality

Data-quality report: one row per expectation with the number of rows that break it. All zero on a healthy database.

Columns: `expectation` text, `violations` bigint.

### feature_hit

One row per fired feature (stage 1 and stage 2): the relational form of the JSON feature lists. No value and no detail, so no personal data.

Columns: `seq` bigint, `stage` smallint, `feature_id` text, `weight` real, `event_time` timestamptz.

### maintainer_change

One row per account added to or removed from a maintainer set: the relational form of the array columns.

Columns: `package` text, `seq` bigint, `observed_at` timestamptz, `account` text, `change` text.

### maintainer_set_masked

maintainer_set with account names replaced by stable pseudonyms; for the read role and for demonstrations.

Columns: `package` text, `seq` bigint, `observed_at` timestamptz, `maintainers` text[], `added` text[], `removed` text[].

### stage2_result_masked

stage2_result without the snapshot and without feature values; for the read role and for demonstrations.

Columns: `seq` bigint, `package` text, `event_time` timestamptz, `enriched_at` timestamptz, `kind` text, `versions` text[], `prescore` real, `final_score` real, `alert` boolean, `features` jsonb, `sources` jsonb, `engine` text, `evidence_purged_at` timestamptz.

## Functions

| Function | Returns | Rights | Description |
|---|---|---|---|
| `account_redact(p jsonb, p_accounts text[])` | jsonb | caller | Replaces every JSON string and key equal to one of the account names by "[excluded]". |
| `apply_retention(p_evidence_days integer, p_delete_all_after timestamptz)` | retention_run | owner (SECURITY DEFINER) | Applies the retention periods: empties snapshots of candidates without an alert after the given number of days, deletes their maintainer-set rows, and after the final date removes the snapshots of alerts and the verdicts. Logs the run in retention_run. |
| `array_redact(p text[], p_accounts text[])` | text[] | caller | Replaces the given account names in a text array by "[excluded]". |
| `evidence_minimise(p jsonb)` | jsonb | caller | Replaces every {"email": address} in a snapshot by {"emailDomain": domain}. |
| `exclusion_apply()` | trigger | owner (SECURITY DEFINER) | Trigger: a new exclusion cleans the stored snapshots and maintainer sets, except those of events with the verdict "confirmed". |
| `features_check()` | trigger | caller | Trigger: every element of a feature list is an object with an id and a numeric weight, and the id is a feature of the right stage. |
| `feed_event_ensure_partitions(p_now timestamptz)` | text[] | owner (SECURITY DEFINER) | Creates the journal partitions for the month of the argument and the next month; returns the names of the new partitions. Runs with the rights of the owner. |
| `finding_audit()` | trigger | owner (SECURITY DEFINER) | Trigger: copies every change of a verdict to finding_history. |
| `grant_app_privileges()` | text[] | caller | Applies the access rights of the three application roles to all current objects; called by the migration service after every run. |
| `maintainer_set_privacy()` | trigger | caller | Trigger: applies the exclusion list to every new or changed maintainer-set row. |
| `mask_email(p_email text)` | text | caller | Masks an e-mail address: "j***@example.org". |
| `pseudonym(p_account text)` | text | caller | Stable pseudonym of an account name: "user-" and ten hex digits of its SHA-256. |
| `refresh_daily_stats()` | void | owner (SECURITY DEFINER) | Refreshes the materialised view daily_stats without blocking readers. Runs with the rights of the owner. |
| `stage2_result_privacy()` | trigger | caller | Trigger: applies evidence_minimise and the exclusion list to every new or changed snapshot. |
