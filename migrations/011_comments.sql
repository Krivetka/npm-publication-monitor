-- The data dictionary lives in the database: every table, column, view and function carries
-- its description. documentation/database/data-dictionary.md is generated from these comments
-- (scripts/db-docs.mjs), so the document cannot drift from the schema.

-- ── Raw layer: the journal ──────────────────────────────────────────────────────────────

comment on table feed_event is 'Raw layer. Journal of the npm registry change feed: one row per change of a package document. It is the work queue of the pipeline and the benign background of the evaluation. Append-only; partitioned by month on observed_at.';
comment on column feed_event.seq is 'Position of the change in the registry feed. Unique over the whole journal; grows with time; gaps are normal.';
comment on column feed_event.package is 'Package name as the registry gives it, with the scope if there is one (for example @scope/name). Never empty.';
comment on column feed_event.rev is 'Revision of the package document, "<number>-<hash>". The number grows by one with every change of the document.';
comment on column feed_event.deleted is 'True when the change is the deletion of the package document.';
comment on column feed_event.observed_at is 'When the collector received the page with this event. Millisecond precision. Partition key; upper bound of the time the event appeared.';
comment on column feed_event.observed_after is 'Lower bound of the time the event appeared: the previous poll that drained the feed. Null for history loaded from a start position. Never later than observed_at.';

comment on table collector_state is 'Read position of the collector, one row per feed. Updated in the same transaction as the events of a page, so a restart continues exactly where the last commit ended.';
comment on column collector_state.feed is 'Name of the feed; the system reads one feed, "npm".';
comment on column collector_state.last_seq is 'Last feed position stored in the journal.';
comment on column collector_state.window_start is 'Lower time bound (observed_after) for the events of the next page.';
comment on column collector_state.head_seq is 'Head position of the registry feed at the last check; head_seq - last_seq is the lag.';
comment on column collector_state.polled_at is 'Last successful poll. The health check fails when it is older than five minutes.';
comment on column collector_state.advanced_at is 'Last time last_seq moved forward.';

comment on table popular_package is 'Daily snapshot of the most downloaded packages: the watchlist and the targets of the name-similarity rules. The seven newest snapshots are kept.';
comment on column popular_package.snapshot is 'Date of the snapshot (UTC).';
comment on column popular_package.rank is 'Place in the list, 1 is the most downloaded. Unique in a snapshot.';
comment on column popular_package.name is 'Package name.';
comment on column popular_package.downloads is 'Download count when the source gives one; null otherwise.';

-- ── Reference data ──────────────────────────────────────────────────────────────────────

comment on table source is 'Reference table: the five external data sources of stage 2. Fixed data, filled by migration 006.';
comment on column source.id is 'Short name used in the code and in source_usage.';
comment on column source.title is 'Name for reports.';
comment on column source.base_url is 'Base address of the service; always https.';

comment on table feature is 'Reference table: catalogue of the features (detection rules) the two engines can emit. Filled from the code catalogue after every migration run; the triggers features_check compare stored results with it.';
comment on column feature.id is 'Identifier of the feature, lower snake case.';
comment on column feature.stage is '1 — computed from the journal alone; 2 — computed from enrichment data.';
comment on column feature.lane is 'Group of related features (temporal, nominal, version, publisher, manifest and so on).';
comment on column feature.weight is 'Current weight of the feature in the score. The weight that was applied to an event is stored with the event.';
comment on column feature.title is 'Name for the dashboard and reports.';
comment on column feature.hint is 'One-sentence explanation for the analyst.';
comment on column feature.active is 'False when the engines no longer emit the feature; the row stays because stored results refer to it.';
comment on column feature.updated_at is 'Last change of the row by the reference sync.';

-- ── Processing layer: stage results ─────────────────────────────────────────────────────

comment on table stage_cursor is 'Journal position of each pipeline stage. Written in the same transaction as the results of a batch: every event is processed exactly once.';
comment on column stage_cursor.stage is 'Name of the stage.';
comment on column stage_cursor.last_seq is 'Last journal position the stage processed.';
comment on column stage_cursor.processed is 'Number of events processed since the first start.';
comment on column stage_cursor.updated_at is 'Time of the last batch.';

comment on table stage1_result is 'Processing layer. Result of stage 1 for an event where at least one feature fired (about one event in four). Events without a row scored zero; the engine is deterministic, so they can be recomputed from the journal.';
comment on column stage1_result.seq is 'The event; one result per event.';
comment on column stage1_result.package is 'Copy of feed_event.package. Controlled redundancy: lists and filters by package read this table without a join to the partitioned journal. View data_quality proves the copies are equal.';
comment on column stage1_result.event_time is 'Copy of feed_event.observed_at; second column of the foreign key to the journal, so the copy cannot differ.';
comment on column stage1_result.prescore is 'Sum of the weights of the fired stage-1 features. Not negative.';
comment on column stage1_result.candidate is 'True when the event goes to stage 2: prescore at or above the threshold, or the package is on the watchlist.';
comment on column stage1_result.features is 'Fired features: a JSON array of {id, lane, weight, value, threshold?, detail?}. Never empty. Every id is a stage-1 row of the feature table (trigger features_check). See the section "JSON columns" of the database document.';
comment on column stage1_result.engine is 'Version of the engine that produced the row: "v<version>:<hash of parameters>@<date of the popular-package snapshot or none>".';

comment on table stage1_hourly is 'Mart layer. Hourly counters of stage 1: the denominator of the filtering evaluation. Updated in the transaction of each batch.';
comment on column stage1_hourly.hour is 'Start of the hour (UTC).';
comment on column stage1_hourly.processed is 'Events processed in the hour.';
comment on column stage1_hourly.flagged is 'Events with at least one fired feature. Not more than processed.';
comment on column stage1_hourly.candidates is 'Events passed to stage 2. Not more than flagged.';

comment on table stage2_result is 'Processing layer. Result of stage 2 for a candidate: enrichment features, the final score, the alert decision and a snapshot of the registry metadata at enrichment time (the registry later removes malicious versions).';
comment on column stage2_result.seq is 'The event; one result per candidate. Refers to the stage-1 result.';
comment on column stage2_result.package is 'Copy of feed_event.package (see stage1_result.package).';
comment on column stage2_result.event_time is 'Copy of feed_event.observed_at; part of the foreign key to stage1_result.';
comment on column stage2_result.enriched_at is 'When stage 2 stored the result. The retention period counts from this time.';
comment on column stage2_result.kind is 'publish — the event carries new versions; metadata — no new version (tags, maintainers); package_missing — the registry no longer has the package; error — the package document could not be read.';
comment on column stage2_result.versions is 'Versions published by the event, in publication order. Empty for the other kinds. Read and written as one value, never joined.';
comment on column stage2_result.prescore is 'Stage-1 score at enrichment time. A historical value: stage 1 can be recomputed later with new parameters.';
comment on column stage2_result.final_score is 'prescore plus the weights of the stage-2 features. Not negative.';
comment on column stage2_result.alert is 'True when the event raised an alert for the analyst.';
comment on column stage2_result.features is 'Fired stage-2 features: JSON array of {id, lane, weight, value, detail?}; may be empty. Every id is a stage-2 row of the feature table.';
comment on column stage2_result.evidence is 'Snapshot of the metadata that explains the score: a JSON object with one key per source (registry, ecosystems_package, ecosystems_publisher, depsdev, github_commit, rdap). Personal data: account names. E-mail addresses are reduced to the domain by trigger. Emptied by the retention job.';
comment on column stage2_result.sources is 'What was asked of each source and what was skipped by quota: a JSON object keyed by source; repeat_of holds the seq of the alert this event repeats.';
comment on column stage2_result.engine is 'Version of the stage-2 engine: "v<version>:<hash of parameters>".';
comment on column stage2_result.evidence_purged_at is 'When the retention job removed the snapshot; null while the snapshot is present.';

comment on table source_usage is 'Mart layer. Requests to the external sources per hour: proof that the quotas hold and the denominator of the cost evaluation.';
comment on column source_usage.hour is 'Start of the hour (UTC).';
comment on column source_usage.source is 'The source.';
comment on column source_usage.requests is 'Requests sent.';
comment on column source_usage.errors is 'Requests that failed.';
comment on column source_usage.skipped is 'Requests not sent because the hourly budget was used up.';

comment on table rdap_cache is 'Cache of domain registration data for publisher e-mail domains. Holds the domain only, never an address. An entry is used for 30 days.';
comment on column rdap_cache.domain is 'Domain name, lower case.';
comment on column rdap_cache.fetched_at is 'When the answer was received.';
comment on column rdap_cache.status is 'HTTP status of the answer (200, 404 and so on).';
comment on column rdap_cache.registered is 'Registration date of the domain, when known.';
comment on column rdap_cache.expires is 'Expiry date of the domain, when known.';

comment on table maintainer_set is 'History of the maintainer set of a package: one row per observed change. Personal data: account names. A row belongs to the stage-2 snapshot it was read from and is deleted with it.';
comment on column maintainer_set.package is 'Package name.';
comment on column maintainer_set.seq is 'The event whose snapshot showed the change.';
comment on column maintainer_set.observed_at is 'Time of that event.';
comment on column maintainer_set.maintainers is 'Complete set after the change, sorted. Stored as one value: the set is a snapshot, compared as a whole.';
comment on column maintainer_set.added is 'Accounts that were not in the previous row. View maintainer_change gives one row per account.';
comment on column maintainer_set.removed is 'Accounts that were in the previous row and are gone.';

-- ── Analyst layer ───────────────────────────────────────────────────────────────────────

comment on table finding is 'Current verdict of the analyst for an event: the ground truth of the evaluation. One verdict per event; any journal event can get one, also an event the pipeline missed.';
comment on column finding.seq is 'The event.';
comment on column finding.observed_at is 'Copy of feed_event.observed_at; second column of the foreign key to the journal.';
comment on column finding.verdict is 'confirmed — a real incident; false_positive — a benign publication; undecided — looked at, no decision yet.';
comment on column finding.note is 'Free text of the analyst.';
comment on column finding.reference is 'Advisory, issue or write-up that confirms the verdict.';
comment on column finding.decided_at is 'Time of the last change.';

comment on table finding_history is 'Audit trail of finding: one row per insert, change or deletion, written by trigger finding_audit. Nobody but the trigger can write here.';
comment on column finding_history.id is 'Surrogate key in order of the changes.';
comment on column finding_history.seq is 'The event.';
comment on column finding_history.operation is 'insert, update or delete.';
comment on column finding_history.verdict is 'Verdict after the change; for delete, the verdict that was removed.';
comment on column finding_history.note is 'Note after the change.';
comment on column finding_history.reference is 'Reference after the change.';
comment on column finding_history.changed_at is 'Time of the change.';
comment on column finding_history.changed_by is 'Database role that made the change.';

-- ── Privacy and operations ──────────────────────────────────────────────────────────────

comment on table exclusion is 'Accounts that used the right to object (GDPR Article 21). The triggers remove the name from stored rows and from every new row.';
comment on column exclusion.account is 'npm user name.';
comment on column exclusion.requested_at is 'When the request was recorded.';
comment on column exclusion.note is 'Reference to the request.';

comment on table retention_run is 'Log of the retention job: one row per run with the number of rows it removed.';
comment on column retention_run.ran_at is 'Start of the run.';
comment on column retention_run.evidence_days is 'Retention period that was applied, in days.';
comment on column retention_run.delete_all_after is 'Final date that was applied; null when none was set.';
comment on column retention_run.snapshots_purged is 'Snapshots of candidates without an alert that were emptied.';
comment on column retention_run.maintainer_rows_purged is 'Maintainer-set rows that were deleted.';
comment on column retention_run.alerts_purged is 'Snapshots of alerts emptied after the final date.';
comment on column retention_run.findings_purged is 'Verdicts deleted after the final date.';

comment on table schema_migrations is 'Version history of the schema: one row per applied migration file.';
comment on column schema_migrations.name is 'File name in migrations/.';
comment on column schema_migrations.applied_at is 'When the migration was applied to this database.';

-- ── Views ───────────────────────────────────────────────────────────────────────────────

comment on view feature_hit is 'One row per fired feature (stage 1 and stage 2): the relational form of the JSON feature lists. No value and no detail, so no personal data.';
comment on view maintainer_change is 'One row per account added to or removed from a maintainer set: the relational form of the array columns.';
comment on view alert is 'Alerts with the stage-1 score, the stage-2 feature ids and the current verdict ("open" when there is none).';
comment on view maintainer_set_masked is 'maintainer_set with account names replaced by stable pseudonyms; for the read role and for demonstrations.';
comment on view stage2_result_masked is 'stage2_result without the snapshot and without feature values; for the read role and for demonstrations.';
comment on materialized view daily_stats is 'Mart layer. Totals per day (UTC): events, packages, flagged, candidates, enriched, alerts, alerts on popular packages, verdicts. Source of KPI-5. Refreshed daily by refresh_daily_stats().';
comment on view data_quality is 'Data-quality report: one row per expectation with the number of rows that break it. All zero on a healthy database.';

-- ── Functions ───────────────────────────────────────────────────────────────────────────

comment on function feed_event_ensure_partitions(timestamptz) is 'Creates the journal partitions for the month of the argument and the next month; returns the names of the new partitions. Runs with the rights of the owner.';
comment on function features_check() is 'Trigger: every element of a feature list is an object with an id and a numeric weight, and the id is a feature of the right stage.';
comment on function finding_audit() is 'Trigger: copies every change of a verdict to finding_history.';
comment on function mask_email(text) is 'Masks an e-mail address: "j***@example.org".';
comment on function pseudonym(text) is 'Stable pseudonym of an account name: "user-" and ten hex digits of its SHA-256.';
comment on function evidence_minimise(jsonb) is 'Replaces every {"email": address} in a snapshot by {"emailDomain": domain}.';
comment on function account_redact(jsonb, text[]) is 'Replaces every JSON string and key equal to one of the account names by "[excluded]".';
comment on function array_redact(text[], text[]) is 'Replaces the given account names in a text array by "[excluded]".';
comment on function stage2_result_privacy() is 'Trigger: applies evidence_minimise and the exclusion list to every new or changed snapshot.';
comment on function maintainer_set_privacy() is 'Trigger: applies the exclusion list to every new or changed maintainer-set row.';
comment on function exclusion_apply() is 'Trigger: a new exclusion cleans the stored snapshots and maintainer sets, except those of events with the verdict "confirmed".';
comment on function apply_retention(integer, timestamptz) is 'Applies the retention periods: empties snapshots of candidates without an alert after the given number of days, deletes their maintainer-set rows, and after the final date removes the snapshots of alerts and the verdicts. Logs the run in retention_run.';
comment on function refresh_daily_stats() is 'Refreshes the materialised view daily_stats without blocking readers. Runs with the rights of the owner.';
comment on function grant_app_privileges() is 'Applies the access rights of the three application roles to all current objects; called by the migration service after every run.';
