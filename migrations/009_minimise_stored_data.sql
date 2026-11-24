-- One-off clean-up of the stored snapshots: e-mail addresses are reduced to their domain.
-- New rows are handled by the trigger stage2_result_privacy (migration 007).
update stage2_result
   set evidence = evidence_minimise(evidence)
 where evidence::text like '%"email": %';
