# Decisions log

These are the calls I made on autopilot. The ones marked ⭐ are worth reviewing.

## Environment
- **Node.js wasn't installed** (and neither was Homebrew). I installed the official Node v24 LTS binary from nodejs.org into `~/.local/node` (checksum verified, no sudo, no system changes). To use it in your shell, add `export PATH="$HOME/.local/node/bin:$PATH"` to `~/.zshrc`, or install Node your usual way.
- Scaffolded by hand instead of with `create-next-app` to keep dependencies minimal: next, react, react-dom and @upstash/redis, plus server-only. The dev dependencies are typescript, tailwind v4, vitest and @types.
- No ESLint. It isn't needed for the quality bar, and leaving it out keeps deps minimal.

## Engine / rules
- ⭐ **Pronouns in reasons.** The PRD example says "city is his #1". I don't infer pronouns from names, so reasons read "city is Karan's #1, ₹9,000 is inside the ₹7,000–₹12,000 range".
- **Elimination `detail` strings:** dates → `not free on those dates`; type → `excludes mountains`; budget → `₹18,000 > cap ₹15,000` (same format as the PRD). `describeElimination()` adds the person's name, so the text matches the fixture exactly ("Preethi excludes mountains").
- **"Minimum" tie:** when several people share the lowest score, the minimum names the first of them in the fixed order Riya, Siddharth, Karan, Aisha, Preethi.
- **Zero-survivor sort:** ascending number of elimination records; ties keep seed-file order.
- **Averages** are stored unrounded and displayed to 1 decimal (80.4). Ranking uses the unrounded value.
- **With 0 submissions,** nothing is ranked. The page says no one has submitted yet instead of showing every option at "0".
- **Provisional results** (fewer than 5 submitted) filter and score using only the people who have submitted.

## Validation (server-side, `lib/validate.ts`)
- ⭐ **The hard cap must be ≥ budget max.** A cap below your own "up to" would contradict it. Blank means the cap equals the budget max, as in the PRD.
- The budget min must be ≤ the max, each date range needs start ≤ end, and at least one range is required.
- A type can't be both ranked and excluded. In the form, ticking a type as a dealbreaker removes it from your ranking. The ranking may be empty (every type then scores "unranked" = 10).
- Limits: at most 20 date ranges, and amounts from ₹0 to ₹1 crore, to stop junk input or storage bloat.
- Client input can never set `confirmedOptionId`/`updatedAt`. Unknown fields are dropped.

## Confirmation / lock
- **You can only confirm one of the currently shown top options.** Confirmations on options that are no longer shown never count toward a lock.
- **Any resubmit clears your confirmation, even with no changes.** The PRD says editing clears it, and "resubmitted" is simpler and more honest than diffing. The form warns before you save.
- **"Back out"** (optionId `null`) is supported alongside switching to a different option.
- If your "I'm in" option drops out of the top 3 (someone else's edit), the results page tells you and asks you to pick again. It doesn't count toward a lock.
- **The same "I'm in" button says "Switch to X"** if you're already in on another option.

## Storage / API
- Redis layout: two hashes, each with one field per person. `group-trip:preferences` holds the records and `group-trip:confirmations` holds `{optionId, version}`. A confirmation counts only while its `version` equals the person's current `updatedAt`. This fixes a lost-update race found during stress testing: confirm used to rewrite the whole record, which could undo an edit saved at the same moment and bring back a stale "I'm in".
- Accepts both `UPSTASH_REDIS_REST_*` and `KV_REST_API_*` env names, whichever the Vercel integration injects.
- The in-memory fallback is kept on `globalThis`. On Vercel it's per-instance and short-lived, which is why the banner shows.
- ⭐ **Wiping all data** (`DELETE /api/preferences`) works freely on the in-memory store. On Redis it needs `RESET_TOKEN` + an `x-reset-token` header, so nobody with the shared WhatsApp link can wipe everyone's data. There's no UI button for it.
- **No auth**, per the PRD. Anyone with the link can submit or confirm as any of the 5 names. That's accepted for a 5-friend MVP.

## UI
- Mobile-first, single column, max width about 32rem, touch targets of 44px or more, and ₹ formatting via `Intl` en-IN.
- The results page re-fetches every 10 s and on window focus, so confirmations from others show up without a manual refresh.
- The phone remembers "who you are" in `localStorage` (a convenience only; it's safe if storage is blocked).
- Eliminated options are shown in a collapsible "Why the other N options are out" section, even when there are survivors.

## Open (from the PRD)
- ⭐ `data/trip-options.json` is still placeholder data for Riya to confirm.
- ⭐ The 50/50 weights are an MVP default (`BUDGET_WEIGHT` / `DESTINATION_WEIGHT` in `lib/engine.ts`).
