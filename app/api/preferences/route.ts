import { NextResponse, type NextRequest } from "next/server";
import { upsertPreference } from "@/lib/engine";
import { getStore } from "@/lib/store";
import { buildState } from "@/lib/state";
import { parsePreferenceInput } from "@/lib/validate";

export const dynamic = "force-dynamic";

/** Upsert one person's preferences. Always clears that person's "I'm in". */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = parsePreferenceInput(body);
  if (!parsed.ok) return NextResponse.json({ errors: parsed.errors }, { status: 400 });

  const store = getStore();
  const next = upsertPreference(await store.getAll(), parsed.value, new Date().toISOString());
  await store.put(next.find((p) => p.name === parsed.value.name)!);
  return NextResponse.json(buildState(store.kind, next));
}

/**
 * Wipe all submissions. Allowed freely on the in-memory store (local dev); on Redis it
 * needs the RESET_TOKEN env var sent as the x-reset-token header, so nobody with the
 * shared link can wipe everyone's data.
 */
export async function DELETE(req: NextRequest) {
  const store = getStore();
  if (store.kind === "redis") {
    const token = process.env.RESET_TOKEN;
    if (!token || req.headers.get("x-reset-token") !== token) {
      return NextResponse.json({ error: "Reset needs a valid x-reset-token header" }, { status: 403 });
    }
  }
  await store.clear();
  return NextResponse.json(buildState(store.kind, []));
}
