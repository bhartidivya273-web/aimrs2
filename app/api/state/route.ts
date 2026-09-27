import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { buildState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  return NextResponse.json(buildState(store.kind, await store.getAll()));
}
