# Group Trip Decider

One shared link for five friends (Riya, Siddharth, Karan, Aisha, Preethi). Each person submits their budget, free dates, destination-type ranking and dealbreakers. The app shows the best 2–3 trip options, how well each one fits each person, and locks one as **Decided** only when all 5 tap "I'm in" on it.

It doesn't book anything and makes no AI/LLM calls. It's a decision layer only. [PRD.md](PRD.md) is the source of truth for requirements, and [DECISIONS.md](DECISIONS.md) lists the calls made during the build.

## Setup

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # Vitest: engine, lock and validation tests
npm run build
```

With no env vars set, the app uses an in-memory store and shows a **"Storage not connected — data may reset"** banner.

## Environment variables

| Var | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST credentials. The Vercel Marketplace Upstash integration sets these. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Also accepted (older Vercel KV naming). |
| `RESET_TOKEN` | Optional. Enables `DELETE /api/preferences` (wipe everything) on Redis when sent as the `x-reset-token` header. Without it, wiping only works on the in-memory store. |

See [.env.example](.env.example). For local dev against Redis, put them in `.env.local`.

### Connecting Upstash on Vercel

1. Vercel dashboard → your project → **Storage** → **Create Database** (or **Marketplace**) → **Upstash** → **Upstash for Redis** → create (free tier is fine) → **Connect to project** (all environments).
2. **Deployments** → latest → **⋯** → **Redeploy**. The banner disappears once storage is connected.

## How it works

```
app/page.tsx            intake form (/)
app/results/page.tsx    results dashboard (/results)
app/api/state           GET   everything the UI needs (records + engine output + lock status)
app/api/preferences     PUT   upsert one person (clears their "I'm in"); DELETE wipe all (guarded)
app/api/confirm         POST  {name, optionId|null} tap "I'm in" / back out
lib/engine.ts           pure matching engine + decision lock
lib/store.ts            Upstash Redis hash (one field per person) or in-memory fallback
data/trip-options.json  fixed seed options (placeholder, for Riya to confirm)
```

## How the scoring works

All of this lives in `lib/engine.ts` as pure, deterministic functions.

**1. Hard filter.** An option is out if, for anyone who has submitted:
- **dates:** the trip isn't fully inside one of their free date ranges,
- **budget:** the cost is above their hard cap (which defaults to their budget max), or
- **type:** it's a destination type they excluded.

Every elimination is recorded as `{optionId, person, rule, detail}`.

**2. Soft score (0–100 per person).**
- `budgetFit`: 100 if the cost is inside their range, 90 if below it, `max(0, 100 − 200 × (cost − max) / max)` if above it.
- `destinationFit`: 100 / 70 / 40 for their #1 / #2 / #3 type, and 10 if the type is unranked.
- `score = round(0.5 × budgetFit + 0.5 × destinationFit)`. Each score comes with a one-line reason.

**3. Aggregate.** Each option gets an average (overall fit) and a minimum (worst-off person). Options rank by average (desc), then minimum (desc), then lower cost. The top 3 are shown.

**Zero survivors:** every option is listed with who knocked it out and why, fewest eliminations first, so the options that are "one change away" come first.

**The lock:** "Decided" is computed, never stored. It means all 5 have submitted and all 5 have the same `confirmedOptionId` on a currently shown option. The lock releases when anyone switches, backs out, or edits their preferences (editing clears their confirmation). Confirmation is disabled until all 5 have submitted.

## Tests

`tests/engine.test.ts` reproduces every number in `data/test-preferences.json → expected`: survivors, ranking, averages, minimums, per-person scores and single-constraint eliminations. It also covers a zero-survivor case. `tests/decision.test.ts` covers the 5-of-5 lock: 4/5 isn't Decided, 5/5 is, and switching, backing out or editing unlocks it.
