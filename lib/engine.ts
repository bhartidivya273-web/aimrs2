/**
 * Matching engine + decision lock. Pure, deterministic functions: no I/O, no clock
 * reads (callers pass `now`), no randomness, no AI. See PRD.md "Matching engine".
 */
import { formatINR } from "./format";
import {
  PEOPLE,
  type DecisionStatus,
  type DestinationType,
  type Elimination,
  type EngineResult,
  type OptionEliminations,
  type PersonName,
  type PersonPreference,
  type PersonScore,
  type PreferenceInput,
  type RankedOption,
  type TripOption,
} from "./types";

export const TOP_N = 3;
export const BUDGET_WEIGHT = 0.5;
export const DESTINATION_WEIGHT = 0.5;
const DESTINATION_FIT_BY_RANK = [100, 70, 40];
const DESTINATION_FIT_UNRANKED = 10;

// ---------- Step 1: hard filter ----------

export function hardCap(pref: PersonPreference): number {
  return pref.budgetHardCap ?? pref.budgetMax;
}

/** ISO "YYYY-MM-DD" strings compare correctly as strings. */
export function isWithinFreeDates(option: TripOption, pref: PersonPreference): boolean {
  return pref.freeDateRanges.some((r) => r.start <= option.start && option.end <= r.end);
}

/** Every hard constraint `option` breaks for `pref`, in rule order dates, budget, type. */
export function eliminationsFor(option: TripOption, pref: PersonPreference): Elimination[] {
  const out: Elimination[] = [];
  const base = { optionId: option.id, person: pref.name };
  if (!isWithinFreeDates(option, pref)) {
    out.push({ ...base, rule: "dates", detail: "not free on those dates" });
  }
  const cap = hardCap(pref);
  if (option.estimatedCostPerPerson > cap) {
    out.push({
      ...base,
      rule: "budget",
      detail: `${formatINR(option.estimatedCostPerPerson)} > cap ${formatINR(cap)}`,
    });
  }
  if (pref.excludedDestinationTypes?.includes(option.destinationType)) {
    out.push({ ...base, rule: "type", detail: `excludes ${option.destinationType}` });
  }
  return out;
}

/** Human sentence for one elimination, e.g. "Preethi excludes mountains". */
export function describeElimination(e: Elimination): string {
  return e.rule === "budget" ? `${e.person}'s budget cap: ${e.detail}` : `${e.person} ${e.detail}`;
}

export function hardFilter(
  options: TripOption[],
  prefs: PersonPreference[],
): { survivors: TripOption[]; eliminations: Elimination[] } {
  const survivors: TripOption[] = [];
  const eliminations: Elimination[] = [];
  for (const option of options) {
    const found = prefs.flatMap((p) => eliminationsFor(option, p));
    if (found.length === 0) survivors.push(option);
    else eliminations.push(...found);
  }
  return { survivors, eliminations };
}

/**
 * Eliminated options with their eliminations, sorted by number of eliminations
 * ascending (single-constraint failures first); ties keep seed order.
 */
export function groupEliminations(
  options: TripOption[],
  eliminations: Elimination[],
): OptionEliminations[] {
  return options
    .map((option, index) => ({
      option,
      index,
      eliminations: eliminations.filter((e) => e.optionId === option.id),
    }))
    .filter((g) => g.eliminations.length > 0)
    .sort((a, b) => a.eliminations.length - b.eliminations.length || a.index - b.index)
    .map(({ option, eliminations }) => ({ option, eliminations }));
}

// ---------- Step 2: soft score ----------

export function budgetFit(cost: number, pref: PersonPreference): number {
  if (cost < pref.budgetMin) return 90;
  if (cost <= pref.budgetMax) return 100;
  return Math.max(0, 100 - (200 * (cost - pref.budgetMax)) / pref.budgetMax);
}

export function destinationFit(type: DestinationType, pref: PersonPreference): number {
  const rank = pref.destinationTypeRanking.indexOf(type);
  return rank >= 0 && rank < DESTINATION_FIT_BY_RANK.length
    ? DESTINATION_FIT_BY_RANK[rank]
    : DESTINATION_FIT_UNRANKED;
}

function budgetReason(cost: number, pref: PersonPreference): string {
  const c = formatINR(cost);
  const range = `${formatINR(pref.budgetMin)}–${formatINR(pref.budgetMax)}`;
  if (cost < pref.budgetMin) return `${c} is below the ${range} range`;
  if (cost <= pref.budgetMax) return `${c} is inside the ${range} range`;
  return `${c} is ${formatINR(cost - pref.budgetMax)} over the ${formatINR(pref.budgetMax)} max`;
}

function destinationReason(type: DestinationType, pref: PersonPreference): string {
  const rank = pref.destinationTypeRanking.indexOf(type);
  return rank >= 0 ? `${type} is ${pref.name}'s #${rank + 1}` : `${type} isn't in ${pref.name}'s ranking`;
}

export function scorePerson(option: TripOption, pref: PersonPreference): PersonScore {
  const b = budgetFit(option.estimatedCostPerPerson, pref);
  const d = destinationFit(option.destinationType, pref);
  const score = Math.round(BUDGET_WEIGHT * b + DESTINATION_WEIGHT * d);
  return {
    person: pref.name,
    score,
    budgetFit: b,
    destinationFit: d,
    reason: `${pref.name}: ${score} — ${destinationReason(option.destinationType, pref)}, ${budgetReason(
      option.estimatedCostPerPerson,
      pref,
    )}`,
  };
}

// ---------- Step 3: aggregate + rank ----------

/** Requires at least one preference. */
export function aggregate(option: TripOption, prefs: PersonPreference[]): RankedOption {
  const scores = sortByPeople(prefs).map((p) => scorePerson(option, p));
  const average = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
  const worst = scores.reduce((min, s) => (s.score < min.score ? s : min));
  return { option, scores, average, minimum: { score: worst.score, person: worst.person } };
}

/** Average desc, then minimum desc, then lower cost. */
export function compareRanked(a: RankedOption, b: RankedOption): number {
  return (
    b.average - a.average ||
    b.minimum.score - a.minimum.score ||
    a.option.estimatedCostPerPerson - b.option.estimatedCostPerPerson
  );
}

export function runEngine(options: TripOption[], prefs: PersonPreference[]): EngineResult {
  if (prefs.length === 0) {
    return { ranked: [], top: [], eliminations: [], eliminatedOptions: [] };
  }
  const { survivors, eliminations } = hardFilter(options, prefs);
  const ranked = survivors.map((o) => aggregate(o, prefs)).sort(compareRanked);
  return {
    ranked,
    top: ranked.slice(0, TOP_N),
    eliminations,
    eliminatedOptions: groupEliminations(options, eliminations),
  };
}

// ---------- Decision lock (unanimous, computed — never stored) ----------

function sortByPeople<T extends { name: PersonName }>(items: T[]): T[] {
  return [...items].sort((a, b) => PEOPLE.indexOf(a.name) - PEOPLE.indexOf(b.name));
}

/**
 * `confirmableIds` = ids of the options currently shown (engine `top`). Confirmations on
 * anything else are ignored, so a stale confirmation can never produce a lock.
 */
export function decisionStatus(prefs: PersonPreference[], confirmableIds: string[]): DecisionStatus {
  const submittedSet = new Set(prefs.map((p) => p.name));
  const submitted = PEOPLE.filter((n) => submittedSet.has(n));
  const missing = PEOPLE.filter((n) => !submittedSet.has(n));
  const allSubmitted = missing.length === 0;

  const confirmations: Record<string, PersonName[]> = {};
  for (const id of confirmableIds) confirmations[id] = [];
  for (const p of sortByPeople(prefs)) {
    if (p.confirmedOptionId && Object.hasOwn(confirmations, p.confirmedOptionId)) {
      confirmations[p.confirmedOptionId].push(p.name);
    }
  }

  const decidedOptionId =
    (allSubmitted &&
      Object.keys(confirmations).find((id) => confirmations[id].length === PEOPLE.length)) ||
    null;

  return { submitted, missing, allSubmitted, confirmations, decidedOptionId };
}

/** Upsert by name. Editing preferences always clears that person's confirmation. */
export function upsertPreference(
  prefs: PersonPreference[],
  input: PreferenceInput,
  now: string,
): PersonPreference[] {
  const record: PersonPreference = { ...input, updatedAt: now };
  delete record.confirmedOptionId; // in case the caller passed a full record
  return sortByPeople([...prefs.filter((p) => p.name !== input.name), record]);
}

export type ConfirmError = "not-all-submitted" | "unknown-person" | "option-not-confirmable";

/**
 * Set (optionId) or clear (null) one person's "I'm in". Only allowed once all 5 have
 * submitted, and only on a currently shown option.
 */
export function applyConfirmation(
  prefs: PersonPreference[],
  name: PersonName,
  optionId: string | null,
  confirmableIds: string[],
): { ok: true; prefs: PersonPreference[] } | { ok: false; error: ConfirmError } {
  if (!prefs.some((p) => p.name === name)) return { ok: false, error: "unknown-person" };
  if (PEOPLE.some((n) => !prefs.some((p) => p.name === n))) {
    return { ok: false, error: "not-all-submitted" };
  }
  if (optionId !== null && !confirmableIds.includes(optionId)) {
    return { ok: false, error: "option-not-confirmable" };
  }
  return {
    ok: true,
    prefs: prefs.map((p) => {
      if (p.name !== name) return p;
      const next = { ...p };
      if (optionId === null) delete next.confirmedOptionId;
      else next.confirmedOptionId = optionId;
      return next;
    }),
  };
}
