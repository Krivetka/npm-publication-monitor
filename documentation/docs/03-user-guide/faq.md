# FAQ

**The status pill says the collector polled minutes ago. Is data lost?**
No. The collector resumes from its stored cursor; events collected during a gap carry a wide appearance interval, and the temporal lane ignores them, so a catch-up never produces a false burst.

**A package I know was published does not appear in the search.**
The journal starts when the collector was first started ("observing since" on the Overview). Names are lower-case; the search tries the lower-case form automatically.

**A candidate shows "awaiting enrichment" for a long time.**
Stage 2 waits for the registry CDN, defers while the version is missing from the packument and gives up after 10 min; an unreachable registry is retried up to five times.

**A source says "skipped: quota".**
Each source has an hourly budget; beyond it the request is not made, the feature is not computed and the skip is counted — the score is then a lower bound.

**The score is above 4 but there is no alert.**
Either no stage-2 feature fired (a metadata-only event cannot alert), or the package already alerted within six hours — the card then says "repeat of".

**Can I get alerts without opening the page?**
Alerts are in the database, in the stage-2 log as `ALERT` lines, on the WebSocket stream as `stage2` messages with `alert: true`, and through `GET /api/v1/events?alert=true`; Swagger UI at `/npm/api/docs` documents every endpoint.

**Where is the raw evidence?**
At the bottom of every card (*Full snapshot (JSON)*) and at `GET /api/v1/events/{seq}`: manifests of the event's and the previous version, publisher history, versions published within ±10 minutes, the last 400 versions, and every source answer.

