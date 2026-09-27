/**
 * Randomized invariant checks: thousands of generated option lists + preference sets.
 * Seeded PRNG, so any failure is reproducible.
 */
import { describe, expect, it } from "vitest";
import {
  applyConfirmation,
  compareRanked,
  decisionStatus,
  eliminationsFor,
  runEngine,
  upsertPreference,
} from "@/lib/engine";
import { parsePreferenceInput } from "@/lib/validate";
import { DESTINATION_TYPES, PEOPLE, type DestinationType, type PersonPreference, type TripOption } from "@/lib/types";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
type R = () => number;
const int = (r: R, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T,>(r: R, xs: readonly T[]) => xs[int(r, 0, xs.length - 1)];
const shuffle = <T,>(r: R, xs: readonly T[]) => [...xs].sort(() => r() - 0.5);
const day = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 86400000).toISOString().slice(0, 10);

function genOptions(r: R): TripOption[] {
  return Array.from({ length: int(r, 0, 12) }, (_, i) => {
    const s = int(r, 0, 60);
    return {
      id: `o${i}`,
      destination: `D${i}`,
      destinationType: pick(r, DESTINATION_TYPES),
      start: day(s),
      end: day(s + int(r, 0, 4)),
      estimatedCostPerPerson: int(r, 1, 40) * 1000 + pick(r, [0, 1, 333, 500, 999]),
    };
  });
}

function genPref(r: R, name: (typeof PEOPLE)[number]): PersonPreference {
  const budgetMin = int(r, 0, 20) * 1000;
  const budgetMax = budgetMin + int(r, 1, 20) * 1000;
  const types = shuffle(r, DESTINATION_TYPES);
  const excluded = r() < 0.3 ? types.slice(0, int(r, 1, 2)) : [];
  const rankable = types.filter((t) => !excluded.includes(t));
  return {
    name,
    budgetMin,
    budgetMax,
    ...(r() < 0.5 ? { budgetHardCap: budgetMax + int(r, 0, 10) * 1000 } : {}),
    freeDateRanges: Array.from({ length: int(r, 1, 4) }, () => {
      const s = int(r, 0, 60);
      return { start: day(s), end: day(s + int(r, 0, 20)) };
    }),
    destinationTypeRanking: rankable.slice(0, int(r, 0, rankable.length)) as DestinationType[],
    excludedDestinationTypes: excluded as DestinationType[],
  };
}

const ITERATIONS = 3000;

describe("engine invariants under random input", () => {
  it(`holds for ${ITERATIONS} random scenarios`, () => {
    const r = rng(42);
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const options = genOptions(r);
      const people = shuffle(r, PEOPLE).slice(0, int(r, 0, 5));
      const prefs = people.map((n) => genPref(r, n));
      const ctx = `iteration ${iter}`;

      // generated prefs are always valid input
      for (const p of prefs) expect(parsePreferenceInput(p).ok, ctx).toBe(true);

      const res = runEngine(options, prefs);
      if (prefs.length === 0) {
        expect(res.top, ctx).toEqual([]);
        continue;
      }

      const survivorIds = new Set(res.ranked.map((x) => x.option.id));
      const eliminatedIds = new Set(res.eliminatedOptions.map((g) => g.option.id));
      // partition: every option is exactly one of survivor / eliminated
      expect(survivorIds.size + eliminatedIds.size, ctx).toBe(options.length);
      for (const o of options) expect(survivorIds.has(o.id) !== eliminatedIds.has(o.id), ctx).toBe(true);

      // survivors break nothing for anyone; eliminated options break something
      for (const x of res.ranked) for (const p of prefs) expect(eliminationsFor(x.option, p), ctx).toEqual([]);
      for (const g of res.eliminatedOptions) expect(g.eliminations.length, ctx).toBeGreaterThan(0);

      // eliminations sorted ascending by count
      const counts = res.eliminatedOptions.map((g) => g.eliminations.length);
      expect(counts, ctx).toEqual([...counts].sort((a, b) => a - b));

      // scores are integers in [0, 100]; one per submitted person; aggregates consistent
      for (const x of res.ranked) {
        expect(x.scores.map((s) => s.person).sort(), ctx).toEqual([...people].sort());
        for (const s of x.scores) {
          expect(Number.isInteger(s.score), ctx).toBe(true);
          expect(s.score, ctx).toBeGreaterThanOrEqual(0);
          expect(s.score, ctx).toBeLessThanOrEqual(100);
          expect(s.reason.startsWith(`${s.person}: ${s.score} — `), ctx).toBe(true);
        }
        const avg = x.scores.reduce((a, s) => a + s.score, 0) / x.scores.length;
        expect(x.average, ctx).toBeCloseTo(avg, 10);
        expect(x.minimum.score, ctx).toBe(Math.min(...x.scores.map((s) => s.score)));
        expect(x.scores.find((s) => s.person === x.minimum.person)?.score, ctx).toBe(x.minimum.score);
      }

      // ranking order and top-N
      for (let i = 1; i < res.ranked.length; i++) {
        expect(compareRanked(res.ranked[i - 1], res.ranked[i]), ctx).toBeLessThanOrEqual(0);
      }
      expect(res.top, ctx).toEqual(res.ranked.slice(0, 3));

      // deterministic + input not mutated
      const snapshot = JSON.stringify([options, prefs]);
      expect(runEngine(options, prefs), ctx).toEqual(res);
      expect(JSON.stringify([options, prefs]), ctx).toBe(snapshot);
    }
  });
});

describe("lock invariants under random confirmation sequences", () => {
  it("Decided iff all 5 submitted and all 5 on the same shown option", () => {
    const r = rng(7);
    for (let iter = 0; iter < 1000; iter++) {
      let prefs = PEOPLE.map((n) => genPref(r, n));
      const options = genOptions(r);
      for (let step = 0; step < 15; step++) {
        const shown = runEngine(options, prefs).top.map((x) => x.option.id);
        const who = pick(r, PEOPLE);
        const roll = r();
        if (roll < 0.15) {
          prefs = upsertPreference(prefs, genPref(r, who), `t${step}`);
          expect(prefs.find((p) => p.name === who)!.confirmedOptionId).toBeUndefined();
        } else {
          const target = roll < 0.25 ? null : roll < 0.3 ? "nope" : shown.length ? pick(r, shown) : "nope";
          const res = applyConfirmation(prefs, who, target, shown);
          if (target !== null && !shown.includes(target)) expect(res.ok).toBe(false);
          if (res.ok) prefs = res.prefs;
        }
        expect(prefs).toHaveLength(5);
        const nowShown = runEngine(options, prefs).top.map((x) => x.option.id);
        const s = decisionStatus(prefs, nowShown);
        const ids = new Set(prefs.map((p) => p.confirmedOptionId));
        const expected = ids.size === 1 && [...ids][0] !== undefined && nowShown.includes([...ids][0]!) ? [...ids][0] : null;
        expect(s.decidedOptionId, `iter ${iter} step ${step}`).toBe(expected);
      }
    }
  });
});
