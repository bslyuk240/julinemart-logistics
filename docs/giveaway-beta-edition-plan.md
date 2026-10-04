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
3. **Sustain**: at least 35% of entries arrive after the first 24 hours (alpha: 24%).
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

### C. Sustain beyond hour one
- **Warm-up phase**: teaser post and reminder opt-in before the code drops.
- **Mid-campaign beats**: day-2 and day-3 content (entry count milestone, early-bird sold out, "last chance"), planned in advance so the Skola Social agent can schedule it.
- Consider a second small code drop on day 2, or a bonus-entry action (share/refer) that also feeds source attribution.
- Decision needed: window length. With a 150 cap and a one-night spike, a 3-day window may be longer than needed. Shorter and louder, or longer with beats.

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
3. **Build the campaign calendar**: C, with Skola briefs for each beat.
4. **Launch, then measure** at 24h, draw day, and 14 days after.

## Measurement

Report at 24h, at draw, and at +14 days: entries by source, entries by day, opt-in rate, offer redemptions, attributed orders and revenue, broadcast delivered/failed by reason, review count and rating.

## Open questions for you

1. **Prize and offer budget**: what discount cost per converted order is acceptable?
2. **Beta scope**: same format with fixes, or test a new variant (referral bonus entries, tiered prizes)? Changing too much at once muddies the comparison.
3. **Window and cap**: keep 3 days and 150, or shorten and raise the cap?
4. **Channel mix**: which channels do you want to test attribution across?
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
