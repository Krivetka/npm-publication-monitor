# INTRODUCTION

**Relevance.** The npm registry is the supply chain of practically every JavaScript application. In the second quarter of 2026 it accounted for 96.6 % of all malicious open-source packages recorded by Sonatype, and the registry's answer — a content scan of every new package before it becomes installable, live since 28 July 2026 — did not prevent the ChainDrop worm a week later: 444 packages and 2 212 versions published in under four hours from compromised but legitimate accounts, with valid provenance attestations. A content scanner cannot tell a stolen credential from its owner; what distinguishes such publications is their metadata — who published, when, in what rhythm, into which release lines — and none of the services examined watches this layer continuously for the consumer.

**Object and subject.** The object is the stream of publication events of the public npm registry; the subject is the detection of suspicious publications from publication metadata alone, under the constraint that the stream is too large to enrich every event from external sources.

**Goal.** To design, implement and experimentally evaluate a continuous monitoring system that flags suspicious npm publications from a combination of metadata features and quantifies the residual risk that remains after the registry's own gate.

**Tasks.** (1) Isolate the attack behaviour classes observable at the metadata layer; (2) build a change-feed collector with no loss across restarts; (3) implement a first filtering stage without external requests, with a preliminary risk score; (4) implement an enrichment stage with quota control and a final risk score; (5) implement storage, a REST API and a single-page dashboard with alerts; (6) evaluate detection quality and the efficiency of the pre-filter.

**Methods.** Measurement of the live feed and of external-source costs before design; a two-stage filtering architecture; a weighted sum of explainable features instead of a trained model; deterministic scoring engines so that the recorded journal can be replayed with injected incident scenarios; replay-based evaluation of recall, precision, detection delay and request-count reduction.

**Structure.** Chapter 1 states the problem, stakeholders, scope and requirements; Chapter 2 the architecture, stack, the seven evaluation criteria as decision records, and the deployment; Chapter 3 is the user guide; Chapter 4 the retrospective with results, known issues and lessons.
