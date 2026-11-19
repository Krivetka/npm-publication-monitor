# CONCLUSIONS

1. Contemporary attacks on the npm supply chain — compromise of a trusted publisher, worm-like propagation across unrelated namespaces, name squatting — are observable at the layer of publication metadata, where the registry's content scan has no visibility. The `node-ipc` incident of May 2026 is fully described by three metadata features: a publisher with no previous release, three versions in non-adjacent release lines within 55 seconds, and a release after 640 days of silence.

2. A durable collector of the registry change feed was built and has run continuously since 14 October 2026 at ≈ 100 000 events per day, with the cursor and the events written in one transaction and the interval of appearance stored for every event, so that downtime produces no false bursts.

3. A first filtering stage that needs no network requests reduces the stream to 2.5 % of events (≈ 100 candidates per hour); enrichment then costs 10 400 requests a day across five sources instead of 422 000, and no source quota has been exhausted.

4. A second stage enriches the candidates from five independent sources under per-source quotas, records every skipped request, and stores an evidence snapshot that survives the registry's purge of the malicious version.

5. The weighted-sum scoring is explainable by construction: every alert decomposes into named features with values, thresholds and weights, and an analyst can confirm or reject it on the event card; these verdicts form the ground truth for the evaluation.

6. Calibration on stored results reduced the alert rate from about 300 to 34 a day on 31 days of background. In a random sample of 120 alerts the analyst confirmed 6 (5 %; 95 % interval 2–11 %); 30 alerts were later confirmed by malware advisories, a median of 16 hours earlier. The reference incidents alert in 10 of 10 insertions: node-ipc after 2.5 minutes, the recorded ChainDrop wave after 6.6 minutes, on 39 % of its packages. Of four held-out waves of 2025, never used for tuning, the two Shai-Hulud waves raise an alert, on about 1 % of their packages; nx and chalk/debug raise none.

7. The limits of the approach are measured, not assumed. One malicious version published from the usual account into the next patch version leaves no trace before enrichment; without a manifest change it leaves none after it either. A light check of install scripts for quiet packages would cost about 11 500 requests a day. Of the six indicators of the requirements, KPI-2 and KPI-3 are met, KPI-4 to KPI-6 in part, and KPI-1 is not: 95.4 % of the period is covered against 99 %. The project complements, rather than replaces, content scanning.
