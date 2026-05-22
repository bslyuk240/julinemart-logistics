-- support_sessions.customer_user_id receives UUIDs from external apps (julineservices)
-- whose users are not in JLO auth.users — drop the FK so cross-app sessions work.
ALTER TABLE support_sessions DROP CONSTRAINT IF EXISTS support_sessions_customer_user_id_fkey;
