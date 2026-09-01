-- Broadens the existing vendor-campaign approval pipeline
-- (approval_status/submitted_at/reviewed_at/reviewed_by/review_notes, already
-- built for vendor-submitted campaigns) to also carry Skola-agent-proposed
-- giveaway campaigns, instead of building a second parallel approval queue.
--
-- admin-vendor-campaigns.js currently finds submissions via
-- `WHERE vendor_id IS NOT NULL` — an agent-submitted campaign has no vendor,
-- so it would be invisible to that queue without this column to key off of.
alter table campaigns add column submitted_via text check (submitted_via in ('vendor', 'skola_agent'));

comment on column campaigns.submitted_via is 'Who submitted this campaign for review, if it went through the approval pipeline (null = created directly by an admin, no review needed). Backfilled to ''vendor'' for existing vendor submissions.';

-- Backfill: every existing campaign with a vendor_id and a non-null
-- approval_status already went through this pipeline as a vendor submission.
update campaigns set submitted_via = 'vendor' where vendor_id is not null and approval_status is not null;
