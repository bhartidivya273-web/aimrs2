import { describe, expect, it } from "vitest";
import fixture from "@/data/test-preferences.json";
import { TRIP_OPTIONS } from "@/lib/options";
import { applyConfirmation, decisionStatus, runEngine, upsertPreference } from "@/lib/engine";
import { PEOPLE, type PersonName, type PersonPreference, type PreferenceInput } from "@/lib/types";

const prefs = fixture.preferences as PersonPreference[];
const shown = runEngine(TRIP_OPTIONS, prefs).top.map((r) => r.option.id);
const [GOKARNA, UDAIPUR] = shown;

function confirmAll(start: PersonPreference[], who: readonly PersonName[], optionId: string) {
  return who.reduce((acc, name) => {
    const r = applyConfirmation(acc, name, optionId, shown);
    if (!r.ok) throw new Error(r.error);
    return r.prefs;
  }, start);
}

describe("5-of-5 lock", () => {
  it("4 of 5 on the same option is NOT Decided", () => {
    const four = confirmAll(prefs, PEOPLE.slice(0, 4), GOKARNA);
    const s = decisionStatus(four, shown);
    expect(s.confirmations[GOKARNA]).toEqual(["Riya", "Siddharth", "Karan", "Aisha"]);
    expect(s.decidedOptionId).toBeNull();
  });

  it("4 on one option + 1 on another is NOT Decided", () => {
    const split = confirmAll(confirmAll(prefs, PEOPLE.slice(0, 4), GOKARNA), ["Preethi"], UDAIPUR);
    expect(decisionStatus(split, shown).decidedOptionId).toBeNull();
  });

  it("5 of 5 on the same option IS Decided", () => {
    const all = confirmAll(prefs, PEOPLE, GOKARNA);
    const s = decisionStatus(all, shown);
    expect(s.confirmations[GOKARNA]).toHaveLength(5);
    expect(s.decidedOptionId).toBe(GOKARNA);
  });

  it("one person changing their confirmation unlocks it", () => {
    const all = confirmAll(prefs, PEOPLE, GOKARNA);
    const switched = confirmAll(all, ["Karan"], UDAIPUR);
    const s = decisionStatus(switched, shown);
    expect(s.decidedOptionId).toBeNull();
    expect(s.confirmations[GOKARNA]).toEqual(["Riya", "Siddharth", "Aisha", "Preethi"]);
    expect(s.confirmations[UDAIPUR]).toEqual(["Karan"]);
  });

  it("one person withdrawing (null) unlocks it", () => {
    const all = confirmAll(prefs, PEOPLE, GOKARNA);
    const r = applyConfirmation(all, "Aisha", null, shown);
    expect(r.ok).toBe(true);
    if (r.ok) expect(decisionStatus(r.prefs, shown).decidedOptionId).toBeNull();
  });

  it("editing preferences clears that person's confirmation and unlocks it", () => {
    const all = confirmAll(prefs, PEOPLE, GOKARNA);
    const { confirmedOptionId: _c, updatedAt: _u, ...riyaInput } = all.find((p) => p.name === "Riya")!;
    const edited = upsertPreference(all, { ...(riyaInput as PreferenceInput), budgetMax: 15000 }, "2026-10-01T00:00:00Z");
    const riya = edited.find((p) => p.name === "Riya")!;
    expect(riya.confirmedOptionId).toBeUndefined();
    expect(riya.budgetMax).toBe(15000);
    expect(riya.updatedAt).toBe("2026-10-01T00:00:00Z");
    const s = decisionStatus(edited, shown);
    expect(s.decidedOptionId).toBeNull();
    expect(s.confirmations[GOKARNA]).toEqual(["Siddharth", "Karan", "Aisha", "Preethi"]);
  });

  it("even an unchanged resubmit clears the confirmation", () => {
    const all = confirmAll(prefs, PEOPLE, GOKARNA);
    const edited = upsertPreference(all, all[0], "2026-10-01T00:00:00Z");
    expect(decisionStatus(edited, shown).decidedOptionId).toBeNull();
  });
});

describe("upsert and confirmation guards", () => {
  it("resubmitting updates the record and never duplicates it", () => {
    let store: PersonPreference[] = [];
    store = upsertPreference(store, prefs[0], "t1");
    store = upsertPreference(store, { ...prefs[0], budgetMin: 9000 }, "t2");
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ name: "Riya", budgetMin: 9000, updatedAt: "t2" });
  });

  it("confirmation is disabled until all 5 have submitted", () => {
    const four = prefs.slice(0, 4);
    expect(applyConfirmation(four, "Riya", GOKARNA, shown)).toEqual({ ok: false, error: "not-all-submitted" });
    const s = decisionStatus(four, shown);
    expect(s.allSubmitted).toBe(false);
    expect(s.missing).toEqual(["Preethi"]);
  });

  it("can only confirm a currently shown option", () => {
    expect(applyConfirmation(prefs, "Riya", "manali-dec11", shown)).toEqual({
      ok: false,
      error: "option-not-confirmable",
    });
  });

  it("confirmations on options no longer shown never count toward a lock", () => {
    const stale = prefs.map((p) => ({ ...p, confirmedOptionId: "manali-dec11" }));
    expect(decisionStatus(stale, shown).decidedOptionId).toBeNull();
  });
});
