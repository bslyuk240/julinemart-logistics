-- Security hardening: rider-documents was created with no content-type or
-- size restriction. Staff open uploaded documents directly via target="_blank"
-- links (RiderVerifications.tsx), so an unrestricted upload lets a rider
-- submit an SVG with an embedded <script> as their "selfie"/ID photo — a
-- stored-XSS vector when staff view it directly — or an arbitrarily large
-- file. Restrict to actual photo formats and a sane size cap; existing
-- uploads are unaffected, only new ones are enforced.
update storage.buckets
set allowed_mime_types = array['image/jpeg','image/png','image/webp'],
    file_size_limit = 5242880 -- 5MB
where id = 'rider-documents';
