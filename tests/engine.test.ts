import { describe, expect, it } from "vitest";
import fixture from "@/data/test-preferences.json";
import { TRIP_OPTIONS } from "@/lib/options";
import {
  budgetFit,
  describeElimination,
  destinationFit,
  eliminationsFor,
  hardFilter,
  runEngine,
  scorePerson,
} from "@/lib/engine";
import type { PersonPreference, TripOption } from "@/lib/types";

const prefs = fixture.preferences as PersonPreference[];
const expected = fixture.expected;
const result = runEngine(TRIP_OPTIONS, prefs);
const byId = (id: string) => TRIP_OPTIONS.find((o) => o.id === id)!;
const pref = (name: string) => prefs.find((p) => p.name === name)!;

describe("fixture: data/test-preferences.json -> expected", () => {
  it("survivors are exactly the expected set", () => {
    const { survivors } = hardFilter(TRIP_OPTIONS, prefs);
    expect(survivors.map((o) => o.id).sort()).toEqual([...expected.survivors].sort());
    expect(result.ranked.map((r) => r.option.id)).toEqual(expected.survivors);
  });

  it("ranking order, averages and minimums match", () => {
    expect(result.top).toHaveLength(expected.ranking.length);
    result.top.forEach((r, i) => {
      const exp = expected.ranking[i];
      expect(r.option.id).toBe(exp.id);
      expect(r.average).toBeCloseTo(exp.average, 10);
      expect(Number(r.average.toFixed(1))).toBe(exp.average);
      expect(r.minimum.score).toBe(exp.minimum);
    });
  });

  it("minimum carries the worst-off person's name", () => {
    const [gokarna, udaipur, jaipur] = result.top;
    expect(gokarna.minimum.person).toBe("Siddharth"); // 85, first in PEOPLE order among ties
    expect(udaipur.minimum.person).toBe("Siddharth");
    expect(jaipur.minimum.person).toBe("Siddharth");
  });

  it("per-person scores match for every surviving option", () => {
    for (const [optionId, scores] of Object.entries(expected.perPersonScores)) {
      const ranked = result.ranked.find((r) => r.option.id === optionId)!;
      const actual = Object.fromEntries(ranked.scores.map((s) => [s.person, s.score]));
      expect(actual).toEqual(scores);
    }
  });

  it("single-constraint eliminations match exactly", () => {
    const singles = result.eliminatedOptions.filter((g) => g.eliminations.length === 1);
    const actual = Object.fromEntries(
      singles.map((g) => [g.option.id, describeElimination(g.eliminations[0])]),
    );
    expect(actual).toEqual(expected.singleConstraintEliminations);
  });

  it("every non-survivor is eliminated, with singles listed first", () => {
    const eliminatedIds = result.eliminatedOptions.map((g) => g.option.id);
    expect(eliminatedIds.sort()).toEqual(
      TRIP_OPTIONS.map((o) => o.id).filter((id) => !expected.survivors.includes(id)).sort(),
    );
    const counts = result.eliminatedOptions.map((g) => g.eliminations.length);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(result.eliminatedOptions.slice(0, 2).map((g) => g.option.id)).toEqual([
      "rishikesh-nov20",
      "pondicherry-dec25",
    ]);
  });

  it("elimination records have {optionId, person, rule, detail}", () => {
    expect(result.eliminations).toContainEqual({
      optionId: "rishikesh-nov20",
      person: "Preethi",
      rule: "type",
      detail: "excludes mountains",
    });
    expect(result.eliminations).toContainEqual({
      optionId: "pondicherry-dec25",
      person: "Siddharth",
      rule: "dates",
      detail: "not free on those dates",
    });
    // Manali ₹18,000 breaks Preethi's ₹15,000 cap
    expect(result.eliminations).toContainEqual({
      optionId: "manali-dec11",
      person: "Preethi",
      rule: "budget",
      detail: "₹18,000 > cap ₹15,000",
    });
  });
});

describe("scoring rules", () => {
  it("budgetFit: inside 100, below 90, above scales down to 0", () => {
    const p = pref("Karan"); // 7,000–12,000
    expect(budgetFit(7000, p)).toBe(100);
    expect(budgetFit(12000, p)).toBe(100);
    expect(budgetFit(6999, p)).toBe(90);
    expect(budgetFit(13000, p)).toBeCloseTo(100 - (200 * 1000) / 12000);
    expect(budgetFit(30000, p)).toBe(0);
  });

  it("destinationFit: 100 / 70 / 40 / unranked 10", () => {
    expect(destinationFit("city", pref("Karan"))).toBe(100);
    expect(destinationFit("beach", pref("Karan"))).toBe(70);
    expect(destinationFit("mountains", pref("Karan"))).toBe(40);
    expect(destinationFit("mountains", pref("Preethi"))).toBe(10);
  });

  it("hard cap defaults to budgetMax when absent", () => {
    const sid = pref("Siddharth"); // no cap, max 20,000
    const pricey: TripOption = { ...byId("gokarna-dec04"), estimatedCostPerPerson: 20001 };
    expect(eliminationsFor(pricey, sid).map((e) => e.rule)).toEqual(["budget"]);
    expect(eliminationsFor({ ...pricey, estimatedCostPerPerson: 20000 }, sid)).toEqual([]);
  });

  it("dates must be fully inside ONE range (spanning two adjacent ranges fails)", () => {
    const p: PersonPreference = {
      ...pref("Riya"),
      freeDateRanges: [
        { start: "2026-12-01", end: "2026-12-04" },
        { start: "2026-12-05", end: "2026-12-10" },
      ],
    };
    expect(eliminationsFor(byId("gokarna-dec04"), p).map((e) => e.rule)).toEqual(["dates"]);
  });

  it("score carries a one-line reason", () => {
    const s = scorePerson(byId("jaipur-dec04"), pref("Karan"));
    expect(s.score).toBe(100);
    expect(s.reason).toBe("Karan: 100 — city is Karan's #1, ₹9,000 is inside the ₹7,000–₹12,000 range");
  });

  it("ties on average break by minimum, then lower cost", () => {
    const a: TripOption = { id: "a", destination: "A", destinationType: "beach", start: "2026-12-04", end: "2026-12-06", estimatedCostPerPerson: 10000 };
    const b: TripOption = { ...a, id: "b", estimatedCostPerPerson: 9500 };
    const r = runEngine([a, b], [pref("Riya")]); // both 100 for Riya
    expect(r.ranked.map((x) => x.option.id)).toEqual(["b", "a"]);
  });

  it("shows at most 3 options", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...byId("gokarna-dec04"), id: `g${i}` }));
    expect(runEngine(many, prefs).top).toHaveLength(3);
  });

  it("no submissions -> nothing ranked", () => {
    expect(runEngine(TRIP_OPTIONS, []).top).toEqual([]);
  });
});

describe("zero survivors", () => {
  // Aisha excludes beach and city, leaving only mountains, which Preethi excludes.
  const strict = prefs.map((p) =>
    p.name === "Aisha"
      ? { ...p, destinationTypeRanking: ["mountains"], excludedDestinationTypes: ["beach", "city"] }
      : p,
  ) as PersonPreference[];
  const r = runEngine(TRIP_OPTIONS, strict);

  it("nothing survives, but every option is listed with its eliminations", () => {
    expect(r.ranked).toEqual([]);
    expect(r.top).toEqual([]);
    expect(r.eliminatedOptions.map((g) => g.option.id).sort()).toEqual(TRIP_OPTIONS.map((o) => o.id).sort());
    for (const g of r.eliminatedOptions) expect(g.eliminations.length).toBeGreaterThan(0);
  });

  it("sorted by elimination count ascending — single-constraint failures first", () => {
    const counts = r.eliminatedOptions.map((g) => g.eliminations.length);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    const singles = r.eliminatedOptions.filter((g) => g.eliminations.length === 1);
    expect(singles.map((g) => g.option.id)).toEqual(["rishikesh-nov20", "udaipur-nov20", "gokarna-dec04", "jaipur-dec04"]); // ties keep seed order
    expect(r.eliminatedOptions.slice(0, singles.length)).toEqual(singles);
    expect(singles.map((g) => describeElimination(g.eliminations[0]))).toEqual([
      "Preethi excludes mountains",
      "Aisha excludes city",
      "Aisha excludes beach",
      "Aisha excludes city",
    ]);
  });
});
