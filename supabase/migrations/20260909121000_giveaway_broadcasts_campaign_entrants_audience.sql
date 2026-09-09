-- Widens giveaway_broadcasts.audience to allow 'campaign_entrants' — a new
-- audience for feedback-request sends: this campaign's valid entrants
-- regardless of win status (unlike 'campaign_non_winners'), each getting
-- their own personalized review link.

alter table giveaway_broadcasts drop constraint giveaway_broadcasts_audience_check;
alter table giveaway_broadcasts add constraint giveaway_broadcasts_audience_check
  check (audience = any (array['opted_in_list', 'campaign_non_winners', 'campaign_entrants']));
