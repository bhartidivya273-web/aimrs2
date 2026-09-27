import { DESTINATION_TYPES, PEOPLE, type DateRange, type DestinationType, type PersonName, type PreferenceInput } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_DATE_RANGES = 20;
/** ₹1 crore per person: far above any real trip, low enough to reject junk. */
export const MAX_AMOUNT = 10_000_000;

export function isPersonName(v: unknown): v is PersonName {
  return typeof v === "string" && (PEOPLE as readonly string[]).includes(v);
}

function isDestinationType(v: unknown): v is DestinationType {
  return typeof v === "string" && (DESTINATION_TYPES as readonly string[]).includes(v);
}

function isValidIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function isAmount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT;
}

/**
 * Validates an intake submission and returns a clean copy (unknown fields dropped,
 * so a client can never set confirmedOptionId or updatedAt through this path).
 */
export function parsePreferenceInput(
  raw: unknown,
): { ok: true; value: PreferenceInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;

  if (!isPersonName(r.name)) errors.push(`Pick your name (${PEOPLE.join(", ")})`);
  if (!isAmount(r.budgetMin)) errors.push(`Enter a “Comfortable from” amount (₹0 to ₹1 crore)`);
  if (!isAmount(r.budgetMax)) errors.push(`Enter an “Up to” amount (₹0 to ₹1 crore)`);
  if (isAmount(r.budgetMin) && isAmount(r.budgetMax) && r.budgetMin > r.budgetMax) {
    errors.push("“Comfortable from” can't be more than “Up to”");
  }
  if (isAmount(r.budgetMax) && r.budgetMax <= 0) errors.push("“Up to” must be more than ₹0");

  const cap = r.budgetHardCap;
  const hasCap = cap !== undefined && cap !== null;
  if (hasCap && !isAmount(cap)) errors.push(`“Absolute max” must be ₹0 to ₹1 crore, or blank`);
  if (hasCap && isAmount(cap) && isAmount(r.budgetMax) && cap < r.budgetMax) {
    errors.push("“Absolute max” can't be lower than “Up to” (leave it blank if they're the same)");
  }

  const ranges = Array.isArray(r.freeDateRanges) ? (r.freeDateRanges as Record<string, unknown>[]) : null;
  if (!ranges || ranges.length === 0) errors.push("Add at least one free date range");
  if (ranges && ranges.length > MAX_DATE_RANGES) {
    errors.push(`At most ${MAX_DATE_RANGES} date ranges`);
    return { ok: false, errors };
  }
  const cleanRanges: DateRange[] = [];
  ranges?.forEach((range, i) => {
    if (!isValidIsoDate(range?.start) || !isValidIsoDate(range?.end)) {
      errors.push(`Date range ${i + 1} needs a valid start and end date`);
    } else if (range.start > range.end) {
      errors.push(`Date range ${i + 1} ends before it starts`);
    } else {
      cleanRanges.push({ start: range.start, end: range.end });
    }
  });

  const ranking = Array.isArray(r.destinationTypeRanking) ? r.destinationTypeRanking : null;
  if (!ranking || !ranking.every(isDestinationType) || new Set(ranking).size !== ranking.length) {
    errors.push("Trip types must be beach, mountains or city, each ranked once");
  }
  const excluded = r.excludedDestinationTypes ?? [];
  if (!Array.isArray(excluded) || !excluded.every(isDestinationType)) {
    errors.push("Dealbreakers must be beach, mountains or city");
  } else if (ranking && excluded.some((t) => ranking.includes(t))) {
    errors.push("A destination type can't be both ranked and excluded");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: r.name as PersonName,
      budgetMin: r.budgetMin as number,
      budgetMax: r.budgetMax as number,
      ...(hasCap ? { budgetHardCap: cap as number } : {}),
      freeDateRanges: cleanRanges,
      destinationTypeRanking: [...new Set(ranking as DestinationType[])],
      excludedDestinationTypes: [...new Set(excluded as DestinationType[])],
    },
  };
}
