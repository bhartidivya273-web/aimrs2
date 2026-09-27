import { NextResponse } from "next/server";
import { getState } from "@/lib/actions";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await getState(getStore());
  return NextResponse.json(r.body, { status: r.status });
}
