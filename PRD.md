# Group Trip Decision Tool — PRD

## Problem

Five friends (Riya, Siddharth, Karan, Aisha, Preethi) have spent 3 months and 1,200+ WhatsApp messages failing to plan one trip. A Google Form got 3 of 5 responses; a group poll collapsed when 2 people changed their minds the next day. Riya wants one link where everyone submits preferences, and a result showing the best 2–3 options and where each person stands on each.

## Goals

- Collect each person's budget, free dates, destination-type preference and dealbreakers through one link.
- Eliminate any option that breaks a hard constraint for anyone.
- Score surviving options per person, rank the top 2–3, show per-person fit and trade-offs.
- Lead to ONE decision that sticks: locked only when all 5 explicitly confirm.

## Non-goals (The Cut)

No flight/hotel search or booking, no payments, no itineraries, no real-time price lookups, no notifications, no accounts, no AI/LLM calls. This is a decision layer, not a travel app.

## Users

All 5 friends have equal weight. Riya shares the link; she has no extra authority. No login: each person identifies themselves by picking their name from the fixed list of 5.

## Data model

**PersonPreference** — one record per person, upserted by name.

| Field | Type | Notes |
|---|---|---|
| name | enum: Riya, Siddharth, Karan, Aisha, Preethi | primary key |
| budgetMin, budgetMax | number (INR) | preferred range |
| budgetHardCap | number, optional | dealbreaker if set; if blank, defaults to budgetMax |
| freeDateRanges | list of {start, end} ISO dates, required, ≥1 | the ONLY availability input; an option must fall fully inside one range |
| destinationTypeRanking | ordered list of beach / mountains / city | 1st = most preferred; may omit types |
| excludedDestinationTypes | list, optional | dealbreaker |
| confirmedOptionId | string, optional | option this person tapped "I'm in" on |
| updatedAt | timestamp | set on every submit |

**TripOption** — fixed seed data in `trip-options.json`, not editable in the app.

| Field | Type |
|---|---|
| id | string |
| destination | string |
| destinationType | beach / mountains / city |
| start, end | ISO dates |
| estimatedCostPerPerson | number (INR) |

## Matching engine (pure, deterministic functions — no AI)

**Step 1 — Hard filter.** For every option and every person who has submitted, the option is eliminated if ANY of:

- (a) dates: `[option.start, option.end]` is not fully inside at least one of the person's `freeDateRanges`;
- (b) budget: `estimatedCostPerPerson > budgetHardCap` (hard cap defaults to budgetMax);
- (c) type: `destinationType` is in the person's `excludedDestinationTypes`.

Record every elimination as `{optionId, person, rule, detail}` (e.g. `{B, Preethi, budget, "₹22,000 > cap ₹15,000"}`).

**Step 2 — Soft score (0–100 per person, per surviving option).** Dates are binary after Step 1, so the soft score uses budget and destination, weighted 50/50 (MVP default):

- budgetFit: cost within [budgetMin, budgetMax] → 100; below budgetMin → 90; above budgetMax → `max(0, 100 − 200 × (cost − budgetMax) / budgetMax)`.
- destinationFit: 1st-ranked type → 100, 2nd → 70, 3rd → 40, unranked → 10.
- score = round(0.5 × budgetFit + 0.5 × destinationFit).
- Each score carries a one-line reason, e.g. "Karan: 85 — city is his #1, ₹9,000 is inside his range".

**Step 3 — Aggregate per option.** `average` (overall fit) and `minimum` (worst-case fit, with the person's name). Rank by average desc, tie-break by minimum desc, then by lower cost. Show top 3 (or fewer if fewer survive).

**Zero survivors.** Never show an empty page. List every option with its eliminations, sorted by number of eliminations ascending (single-constraint failures first), e.g. "Option B: failed only on Preethi's ₹15,000 budget cap."

**Incomplete submissions.** Until all 5 have submitted, show results as "Provisional — waiting on: <names>". Confirmation is disabled until all 5 have submitted.

## Decision confirmation (unanimous)

- Each person taps "I'm in" on one of the shown options (sets their `confirmedOptionId`).
- Dashboard shows per option who is in, e.g. "3 of 5 in: Riya, Karan, Aisha".
- The option is **Decided** only when all 5 have the same `confirmedOptionId`. Decided status is computed, not stored.
- Anyone changing their confirmation, or editing their preferences (which clears their confirmation), visibly unlocks the decision. Backing out happens in the tool, not silently in chat.

## Screens

1. **Intake (`/`)** — pick your name; if a record exists, the form pre-fills with it. Fields: budget min/max, optional hard cap, one or more free date ranges (add/remove), rank destination types, optional exclusions. Submit = upsert.
2. **Results (`/results`)** — submission status (who's in / missing), top 2–3 options as cards with average, minimum, a per-person score table with reasons, and "I'm in" buttons; zero-survivor view when needed; a clear "Decided" banner when 5/5 confirm.

## Success metrics

| Metric | Baseline | Target |
|---|---|---|
| Time to confirmed decision | 3 months, unresolved | < 1 week from link sent |
| Messages to decide | 1,200+ | < 50 |
| Submission completion | 3 of 5 | 5 of 5 |
| Decision sticks | 0 of 1 | 1 of 1 (5/5 lock) |

## Risks

| Risk | Mitigation |
|---|---|
| Someone never submits | Status shows who's missing; confirmation disabled until 5/5 submit |
| Someone changes their mind before deciding | Editable submissions (upsert) |
| Zero options survive | Show who/which constraint eliminated each option, single failures first |
| Survivors but none suits everyone | Show average and minimum side by side |
| Reversal after deciding | Lock only at 5/5 named confirmations; any change visibly unlocks |
| One holdout blocks the lock | Accepted for MVP: unanimity is the point; the per-person table shows why they're holding out |

## Open questions

- Final seed list of options, dates and costs (current `trip-options.json` is placeholder data for Riya to confirm).
- Scoring weights (50/50 is an MVP default).
