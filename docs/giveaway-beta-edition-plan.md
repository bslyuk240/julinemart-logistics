# Giveaway Beta Edition: Plan

Draft, 2026-10-04. Built from the post-mortem of the alpha edition (Geepas Juice Extractor, Sep 10-13), the only giveaway run so far, using live DB data.

## What the alpha edition told us

| Worked | Didn't |
|---|---|
| 74 entries, 61 valid, 49% of the 150 cap | 0 orders attributed, 0 redemptions of the 20% and 15% vouchers |
| 61% of entries in the first hour, audience was primed | Entries almost dead after day 1 (2 on days 3-4) |
| Clean draw, winner redeemed prize voucher | `source` empty on all 74 entries, no channel attribution |
| 20 entrants (27%) created accounts | 100% marketing opt-in, so the checkbox is likely not a real choice |
| 9 reviews, 4.3 stars, "free and fair" | Feedback blast sent 4 times to the same list: 96 of 126 attempts failed (Meta throttling) |
| Consolation template delivered and read well | Consolation broadcast stopped at about 40 of 60 recipients |

## Goals for the beta edition (proposed)

1. **Convert**: at least 10% of valid entrants place a paid order within 14 days (alpha: about 0%).
2. **Attribute**: every entry carries a channel, and every voucher-driven order carries the campaign ID.
3. **Grow the Channel**: WhatsApp Channel joins from social pages in the run-up to the drop (the main goal; alpha baseline not measured).
4. **Clean list**: opt-in reflects real consent, and no broadcast fails to throttling.

Targets are guesses to be confirmed. The alpha is the only baseline.

## Workstreams

### A. Convert (biggest gap)
- Replace the flat 15% consolation with an **expiring offer** (48-72h) plus a reason to act now. Candidate: free shipping above a threshold, or a tiered voucher by entry tier.
- Send the offer **within hours of the draw**, not after a delay, and make the link carry the voucher so checkout is one tap.
- Keep the early-bird voucher, but make it unlockable only at checkout within 24h.
- Decision needed: voucher economics. See open questions.

### B. Attribution
- Add `?src=` (or per-channel links) to the entry URL: WhatsApp Channel, status, Instagram, TikTok, ads, referral. Persist it to `giveaway_entries.source` (column already exists, currently null).
- Confirm every voucher used by an entrant (including the grand-prize voucher) is tagged to the campaign so `orders.campaign_id` populates. The alpha shows the prize voucher used but 0 attributed orders; verify cause first.
- Analytics is fine as is: the alpha logged 76 entry-submitted events from 60 sessions against 74 entries (61 valid), and 73 visitor sessions, so about 82% of visitors entered. No server-side counting needed.

### C. Timing: short drop, live draw (decided)
Alpha data: 61% of entries in the first hour, 97% by end of day 2, almost nothing after. Four days was mostly dead time, and the draw came after the excitement had gone.
- **The code drops in the WhatsApp Channel only.** Social pages are lead sources that send people to the Channel (goal: Channel growth). Social pages still get tagged links (`?src=`) for lead attribution.
- **Announce the drop time in advance** from every social page ("code drops at 7pm in the Channel"), and remind in the Channel an hour before. That is the Channel-growth mechanism.
- **Entry window: about 2-3 hours** after the drop, then the **live draw right at close** (existing live-draw page). The alpha's first 3 hours held about 70% of all entries.
- **Cap lifted.** Leave `entry_limit` blank in the Giveaways admin page (blank saves null and the entry endpoint only enforces a cap when set). Keep the 10 early-bird slots as the first-in perk.
- **Same night after the draw:** announce the winner in the Channel, set a claim deadline in the announcement, and send the expiring consolation offer (workstream A).
- **Entry limits raised for a bigger first-minute spike** (a shorter window concentrates entries):
  - Per-campaign ceiling: 40 to **150 entries/minute** (`isCampaignEntryRateExceeded`). The alpha peaked at 45 in its whole first hour.
  - Per-IP entry limit: 5 to **20 per 5 minutes**; per-IP code check: 15 to **40 per minute**. Nigerian mobile carriers often share IPs across many users. The per-campaign ceiling is the real flood guard.
  - Not load-tested; confirm the numbers against the real first-minute peak after the beta and adjust.
  - Early-bird position is a count-then-insert and can hand the same position to several entrants in a burst, so more than 10 people may get early-bird in a sharp spike. The voucher's own 10-use cap still bounds the cost.
- Optional later: bonus entries for sharing, which also feeds source attribution. Not part of this round.

### D. Consent and list quality
- Verify in `GiveawayEntrySection.tsx` whether the opt-in checkbox is pre-ticked or required. Make it an **unticked, optional** choice with clear WhatsApp and email wording.
- Expect the opt-in rate to drop sharply. That's a better list, not a worse result.

### E. Broadcast safety
- One send per recipient per template per campaign, enforced server-side in the broadcast function (not by UI discipline). Re-run only targets recipients with no prior non-failed message.
- Resume a stopped broadcast instead of re-sending to everyone. Investigate why the consolation run stopped at about 40 of 60 and show it in the admin UI.
- Show Meta's failure reason on the broadcast summary, and warn before any resend to a list that already received that template.
- Watch the template quality rating after the alpha's repeat sends.

### F. Reviews and trust
- Ask for feedback once, at a good moment (day after the draw), targeted at engaged recipients.
- Publish the draw result (public-safe name, location) as social proof; the fairness reviews are an asset.

## Sequencing

1. **Fix before launch**: E (broadcast safety), B (attribution), D (consent). These are small and protect the next run.
2. **Design the offer**: A, once the economics decision is made.
3. **Timing and capacity**: C. Raise or review the entry rate limits first, then build the announcement and reminder posts (Skola briefs).
4. **Launch, then measure** at 24h, draw day, and 14 days after.

## Measurement

Report at 24h, at draw, and at +14 days: entries by source, entries by day, opt-in rate, offer redemptions, attributed orders and revenue, broadcast delivered/failed by reason, review count and rating.

## Open questions for you

1. **Prize and offer budget**: what discount cost per converted order is acceptable?
2. **Beta scope**: same format with fixes, or test a new variant (referral bonus entries, tiered prizes)? Changing too much at once muddies the comparison.
3. ~~Window and cap~~ Decided: short window (about 2-3 hours) with a live draw, cap lifted. Exact window length still to pick.
4. **Channel mix**: which social pages feed the Channel, and what tag does each use? (The code itself drops only in the Channel.)
5. **Opt-in wording**: ok to ship the stricter checkbox and accept a lower opt-in count?

## Resolved since the first draft

- **Consolation broadcast stopped at about 40 of 60:** it ran on the old synchronous path (Sep 13, 18:09). The background-function fix landed 30 minutes later (commit `dc3c03d`). Not re-tested live.
- **Opt-in 100%:** confirmed pre-ticked (`useState(true)`); now unticked by default.
- **Prize voucher attribution:** the three giveaway vouchers have `campaign_id = null`, and order attribution read only that field. `create-order.js` now falls back to the campaign that references the voucher. Lookup checked against real IDs, no live order run.
- **Winner's first order (#1160) burned the prize voucher:** the 100%-off fix and release-on-cancel both landed on Sep 14, after that order. A replacement code was used for the delivered order (#1161). Already fixed.
- **Analytics:** no undercount (see workstream B).

## Still open

- Channel mix: no source data exists for the alpha; the new `?src=` tags fix that going forward.
- Live end-to-end checkout test of the attribution fallback.
