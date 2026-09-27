import { NextResponse, type NextRequest } from "next/server";
import { applyConfirmation, runEngine } from "@/lib/engine";
import { TRIP_OPTIONS } from "@/lib/options";
import { getStore } from "@/lib/store";
import { buildState } from "@/lib/state";
import { isPersonName } from "@/lib/validate";

export const dynamic = "force-dynamic";

const MESSAGES = {
  "not-all-submitted": "Confirmation opens once all 5 have submitted.",
  "unknown-person": "Submit your preferences first.",
  "option-not-confirmable": "That option isn't one of the current top options.",
} as const;

/** Body: { name, optionId } to tap "I'm in"; optionId null to back out. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { name?: unknown; optionId?: unknown } | null;
  if (!body || !isPersonName(body.name)) {
    return NextResponse.json({ error: "Pick your name first." }, { status: 400 });
  }
  if (body.optionId !== null && typeof body.optionId !== "string") {
    return NextResponse.json({ error: "optionId must be a string or null" }, { status: 400 });
  }

  const store = getStore();
  const prefs = await store.getAll();
  const shown = runEngine(TRIP_OPTIONS, prefs).top.map((r) => r.option.id);
  const r = applyConfirmation(prefs, body.name, body.optionId, shown);
  if (!r.ok) return NextResponse.json({ error: MESSAGES[r.error] }, { status: 409 });

  await store.put(r.prefs.find((p) => p.name === body.name)!);
  return NextResponse.json(buildState(store.kind, r.prefs));
}
