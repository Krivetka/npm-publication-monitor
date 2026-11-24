# Criterion 6 — Cloud

## Context

The pipeline must run unattended for the whole observation period: every hour of collector downtime is a hole in the benign background. The project has no hosting budget, and the database grows by about 1.2 GB a month.

## Decision

An on-premise deployment, not a cloud one: compute and database on a dedicated always-on node (Ubuntu 26.04, Docker Engine; Fig. 2.7). Orchestration — Docker Compose: one image, seven services, `restart: unless-stopped`; the stack survives reboots and resumes from its cursors. Access — nginx on the node serves the dashboard inside the home network and a private Tailscale network; nothing is exposed to the internet. Logs — rotated container logs on the node. Health — `GET /api/v1/health` returns 503 when the collector has not polled for 5 minutes or stage 1 is over 5 000 events behind. Backups — a nightly database dump, kept 14 days.

## Alternatives

| Alternative | Why rejected |
|---|---|
| A paid cloud VM | no budget; the same compose file would run there unchanged |
| Managed Kubernetes | seven single-process services with one database need no cross-node scheduling |
| Managed logs and an external uptime check | prepared (`deploy/compose.logs.yml`), not enabled: one analyst reads the logs on the node |

## Consequences

The node is a single point of failure, and nothing outside it reports a failure: the outage of 5 November (an unattended reboot of an encrypted disk) lasted ten hours and was found by hand. No event was lost: the collector resumed from its cursor.

## Key decisions

- One always-on node, no public surface.
- Health with real semantics (503 on a stale collector).
- No secrets on the node except `.env` (mode 600); none in Git.

## Structure

Fig. 2.7 shows the node and its containers.

## Requirements compliance checklist

Table: Cloud criterion checklist

| Requirement | Status | Where |
|---|---|---|
| Containerisation and orchestration | done | `Dockerfile`, `docker-compose.yml` |
| Automatic start and restart | done | `restart: unless-stopped`; verified across a reboot |
| Deployment on a cloud server | not done — on-premise node | this section |
| Centralised log collection | not done — overlay prepared | `deploy/compose.logs.yml` |
| Collector health monitoring | done; no failure alerting | `/api/v1/health` |
| Continuous operation | done | since 14 October 2026; one outage of 10 h |
