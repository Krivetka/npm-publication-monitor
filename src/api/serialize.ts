// Database rows → API objects with the field names of the OpenAPI schemas (snake_case,
// ISO dates, seq as a number).

import type { Feature } from '../lib/feature.ts';
import type { Status } from '../web/queries.ts';

export interface ApiStage1 {
  prescore: number;
  candidate: boolean;
  features: Feature[];
  engine: string;
}

export interface ApiStage2 {
  kind: string;
  versions: string[];
  prescore: number;
  final_score: number;
  alert: boolean;
  features: Feature[];
  enriched_at: string;
  engine: string;
}

export interface ApiFinding {
  seq: number;
  verdict: string;
  note?: string;
  reference?: string;
  decided_at: string;
}

export interface ApiEvent {
  seq: number;
  package: string;
  rev: string;
  deleted: boolean;
  observed_at: string;
  observed_after: string | null;
  stage1: ApiStage1 | null;
  stage2: ApiStage2 | null;
  finding: ApiFinding | null;
}

// One row of the joined journal query (feed_event ⟕ stage1_result ⟕ stage2_result ⟕ finding).
export interface EventRow {
  seq: string | number;
  package: string;
  rev: string;
  deleted: boolean;
  observed_at: Date;
  observed_after: Date | null;
  s1_prescore: number | null;
  s1_candidate: boolean | null;
  s1_features: Feature[] | null;
  s1_engine: string | null;
  s2_kind: string | null;
  s2_versions: string[] | null;
  s2_prescore: number | null;
  s2_final_score: number | null;
  s2_alert: boolean | null;
  s2_features: Feature[] | null;
  s2_enriched_at: Date | null;
  s2_engine: string | null;
  f_verdict: string | null;
  f_note: string | null;
  f_reference: string | null;
  f_decided_at: Date | null;
}

const iso = (d: Date | string | null | undefined): string | null => (d === null || d === undefined ? null : new Date(d).toISOString());

export function toFinding(seq: number, r: { verdict: string | null; note: string | null; reference: string | null; decided_at: Date | null }): ApiFinding | null {
  if (r.verdict === null || r.decided_at === null) return null;
  return {
    seq,
    verdict: r.verdict,
    ...(r.note ? { note: r.note } : {}),
    ...(r.reference ? { reference: r.reference } : {}),
    decided_at: iso(r.decided_at)!,
  };
}

export function toEvent(r: EventRow): ApiEvent {
  const seq = Number(r.seq);
  return {
    seq,
    package: r.package,
    rev: r.rev,
    deleted: r.deleted,
    observed_at: iso(r.observed_at)!,
    observed_after: iso(r.observed_after),
    stage1:
      r.s1_prescore === null
        ? null
        : { prescore: r.s1_prescore, candidate: r.s1_candidate === true, features: r.s1_features ?? [], engine: r.s1_engine ?? '' },
    stage2:
      r.s2_final_score === null
        ? null
        : {
            kind: r.s2_kind ?? 'publish',
            versions: r.s2_versions ?? [],
            prescore: r.s2_prescore ?? 0,
            final_score: r.s2_final_score,
            alert: r.s2_alert === true,
            features: r.s2_features ?? [],
            enriched_at: iso(r.s2_enriched_at)!,
            engine: r.s2_engine ?? '',
          },
    finding: toFinding(seq, { verdict: r.f_verdict, note: r.f_note, reference: r.f_reference, decided_at: r.f_decided_at }),
  };
}

export interface ApiStatus {
  now: string;
  collector: { last_seq: number; head_seq: number | null; lag: number | null; polled_at: string; advanced_at: string } | null;
  stage1: { last_seq: number; lag: number; updated_at: string } | null;
  stage2: { queue: number; last_at: string | null };
  popular: { snapshot: string | null; names: number };
  journal: { first: string | null; estimate: number };
}

export function toStatus(s: Status, now = new Date()): ApiStatus {
  return {
    now: now.toISOString(),
    collector: s.collector
      ? {
          last_seq: s.collector.lastSeq,
          head_seq: s.collector.headSeq,
          lag: s.collector.headSeq === null ? null : Math.max(0, s.collector.headSeq - s.collector.lastSeq),
          polled_at: iso(s.collector.polledAt)!,
          advanced_at: iso(s.collector.advancedAt)!,
        }
      : null,
    stage1: s.stage1 ? { last_seq: s.stage1.lastSeq, lag: s.stage1.lag, updated_at: iso(s.stage1.updatedAt)! } : null,
    stage2: { queue: s.stage2.queue, last_at: iso(s.stage2.lastAt) },
    popular: { snapshot: s.popular.snapshot, names: s.popular.names },
    journal: { first: iso(s.journal.first), estimate: s.journal.estimate },
  };
}

export interface Health {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail: string }>;
}

// 200 when the collector polled within 5 minutes and stage 1 is less than 5 000 events behind.
// Stage 2 is reported but does not fail the check: its queue depends on external sources.
export function healthFrom(s: Status, now = Date.now()): Health {
  const polledAgoS = s.collector ? Math.round((now - new Date(s.collector.polledAt).getTime()) / 1000) : null;
  const collector = { ok: polledAgoS !== null && polledAgoS <= 300, detail: polledAgoS === null ? 'never polled' : `polled ${polledAgoS} s ago` };
  const stage1 = { ok: s.stage1 !== null && s.stage1.lag < 5000, detail: s.stage1 ? `${s.stage1.lag} events behind the journal` : 'never ran' };
  const stage2 = { ok: s.stage2.queue < 500, detail: `${s.stage2.queue} candidates queued (informational)` };
  return { ok: collector.ok && stage1.ok, checks: { collector, stage1, stage2 } };
}
