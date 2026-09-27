import { describe, expect, it } from "vitest";
import fixture from "@/data/test-preferences.json";
import { parsePreferenceInput } from "@/lib/validate";
import { formatINR } from "@/lib/format";

describe("parsePreferenceInput", () => {
  it("accepts every fixture record", () => {
    for (const p of fixture.preferences) expect(parsePreferenceInput(p).ok).toBe(true);
  });

  it("strips confirmedOptionId / updatedAt from client input", () => {
    const r = parsePreferenceInput({ ...fixture.preferences[0], confirmedOptionId: "x", updatedAt: "y" });
    expect(r.ok && "confirmedOptionId" in r.value).toBe(false);
    expect(r.ok && "updatedAt" in r.value).toBe(false);
  });

  it("rejects bad input", () => {
    const base = fixture.preferences[0];
    expect(parsePreferenceInput({ ...base, name: "Bob" }).ok).toBe(false);
    expect(parsePreferenceInput({ ...base, budgetMin: 20000 }).ok).toBe(false);
    expect(parsePreferenceInput({ ...base, freeDateRanges: [] }).ok).toBe(false);
    expect(parsePreferenceInput({ ...base, freeDateRanges: [{ start: "2026-12-06", end: "2026-12-04" }] }).ok).toBe(false);
    expect(parsePreferenceInput({ ...base, freeDateRanges: [{ start: "2026-02-30", end: "2026-03-01" }] }).ok).toBe(false);
    expect(parsePreferenceInput({ ...base, budgetHardCap: 100 }).ok).toBe(false);
    expect(parsePreferenceInput({ ...base, excludedDestinationTypes: ["beach"] }).ok).toBe(false);
    expect(parsePreferenceInput({ ...base, destinationTypeRanking: ["beach", "beach"] }).ok).toBe(false);
  });
});

describe("formatINR", () => {
  it("uses en-IN grouping", () => {
    expect(formatINR(22000)).toBe("₹22,000");
    expect(formatINR(150000)).toBe("₹1,50,000");
  });
});
