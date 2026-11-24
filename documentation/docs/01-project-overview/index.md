# 1. Project Overview

## Purpose and audience

This chapter is the business-analysis view of the project — problem, users, scope, success criteria — written for the committee, the supervisor and the reviewer.

## Vision statement

For security engineers and maintainers who depend on the npm registry, the npm Publication Monitor is a continuous early-warning service that flags suspicious publications minutes after they happen, before the code is analysed and before the registry removes the evidence. Unlike content scanners and vulnerability databases, which see malware only once it is recognised, the monitor works on publication metadata, where a compromised publisher is visible and an attestation proves nothing.

## Executive summary

The registry's content scan, live since 28 July 2026, is blind to a compromised publisher: the poisoned versions of ChainDrop carried valid attestations. The project builds a system on the adjacent layer: a durable collector of the change feed; stage 1, scoring every event without network requests; stage 2, enriching only the candidates under quotas and storing an evidence snapshot before the registry purges the version; an API, a live stream and a dashboard; and an evaluation replaying recorded incidents of 2025–2026 on the recorded background.

## Alternatives considered

Table: Solution alternatives

| Option | Why not chosen |
|---|---|
| Content scanning of every tarball | duplicates the registry's gate; blind to compromised publishers; 18–27 GB/day |
| Polling a fixed list of important packages | misses new packages, typosquats and worm propagation |
| Machine-learning classifier | no labelled corpus; unexplainable verdicts |
| Subscribing to vulnerability databases | reactive by definition; used only as deferred confirmation |
