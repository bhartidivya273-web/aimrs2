import { NextResponse, type NextRequest } from "next/server";
import { submitPreferences } from "@/lib/actions";
import { getStore } from "@/lib/store";
import { buildState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ errors: ["Request body must be JSON"] }, { status: 400 });
  }
  const r = await submitPreferences(getStore(), body, new Date().toISOString());
  return NextResponse.json(r.body, { status: r.status });
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
