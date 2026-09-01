-- Records which recipient set a broadcast targeted, so history distinguishes
-- "code just dropped" (whole opt-in list) from "didn't win? here's a reward"
-- (this campaign's non-winning entrants) runs.
alter table giveaway_broadcasts add column audience text not null default 'opted_in_list'
  check (audience in ('opted_in_list', 'campaign_non_winners'));
