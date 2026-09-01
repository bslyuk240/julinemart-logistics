-- Advisor follow-up on 20260901120000_create_giveaway_engine.sql:
-- 1) update_giveaway_entry_timestamp had no pinned search_path.
-- 2) Postgres grants EXECUTE to PUBLIC by default on function creation, so the
--    explicit "grant ... to authenticated" in the prior migration did NOT
--    actually restrict anon/public — it only added an already-redundant grant.
--    The functions' own internal admin check made anon calls harmless, but the
--    grant should enforce this too, not just the runtime check.

alter function update_giveaway_entry_timestamp() set search_path = public;

revoke execute on function draw_giveaway_winner(uuid) from public;
revoke execute on function draw_giveaway_winner(uuid) from anon;

revoke execute on function forfeit_and_redraw_giveaway_winner(uuid, text) from public;
revoke execute on function forfeit_and_redraw_giveaway_winner(uuid, text) from anon;
