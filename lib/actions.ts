import { applyConfirmation, runEngine, upsertPreference } from "./engine";
import { TRIP_OPTIONS } from "./options";
import { buildState } from "./state";
import { versionOf, type PreferenceStore } from "./store-core";
import { isPersonName, parsePreferenceInput } from "./validate";

export interface ActionResult {
  status: number;
  body: unknown;
}

const CONFIRM_ERRORS = {
  "not-all-submitted": "Confirmation opens once all 5 have submitted.",
  "unknown-person": "Submit your preferences first.",
  "option-not-confirmable": "That option isn't one of the current top options.",
} as const;

const state = async (store: PreferenceStore): Promise<ActionResult> => ({
  status: 200,
  body: buildState(store.kind, await store.getAll()),
});

export const getState = state;

/** Upsert one person's preferences. Always clears that person's "I'm in". */
export async function submitPreferences(store: PreferenceStore, raw: unknown, now: string): Promise<ActionResult> {
  const parsed = parsePreferenceInput(raw);
  if (!parsed.ok) return { status: 400, body: { errors: parsed.errors } };
  const next = upsertPreference(await store.getAll(), parsed.value, now);
  await store.putPreference(next.find((p) => p.name === parsed.value.name)!);
  return state(store);
}

/** Body: { name, optionId } to tap "I'm in"; optionId null to back out. */
export async function confirmChoice(store: PreferenceStore, raw: unknown): Promise<ActionResult> {
  const body = (raw && typeof raw === "object" ? raw : {}) as { name?: unknown; optionId?: unknown };
  if (!isPersonName(body.name)) return { status: 400, body: { error: "Pick your name first." } };
  if (body.optionId !== null && typeof body.optionId !== "string") {
    return { status: 400, body: { error: "optionId must be a string or null" } };
  }
  const prefs = await store.getAll();
  const shown = runEngine(TRIP_OPTIONS, prefs).top.map((r) => r.option.id);
  const r = applyConfirmation(prefs, body.name, body.optionId, shown);
  if (!r.ok) return { status: 409, body: { error: CONFIRM_ERRORS[r.error] } };

  // Tag with the version we validated against: if this person edits meanwhile, it won't count.
  const me = prefs.find((p) => p.name === body.name)!;
  await store.setConfirmation(body.name, body.optionId, versionOf(me));
  return state(store);
}
