-- A later door-exit witness corroborates an unchanged earlier vacancy; it does not sign that bed fact.
CREATE OR REPLACE VIEW hims.effective_bed_turnovers AS
SELECT t.id,t.bed_id,t.stay_id,t.admission_id,s.ended_at vacated_at,t.reason,t.signed_by,t.signed_at,
 a.id amendment_id,p.id evidence_id,t.vacated_at original_vacated_at,
 coalesce(v.shift_id,p.shift_id) cutoff_shift_id,
 coalesce(v.signed_by,p.signed_by) cutoff_signed_by,
 coalesce(v.signed_at,p.signed_at) cutoff_signed_at,
 coalesce(v.handover,p.notes) cutoff_findings
FROM hims.bed_turnovers t JOIN hims.effective_room_stays s ON s.id=t.stay_id
LEFT JOIN LATERAL (SELECT * FROM hims.stay_boundary_amendments WHERE stay_id=t.stay_id ORDER BY version DESC LIMIT 1) a ON true
LEFT JOIN hims.exception_evidence p ON p.id=a.evidence_id
LEFT JOIN hims.effective_vacation_facts v ON v.stay_id=t.stay_id;
