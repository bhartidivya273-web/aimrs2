import { NextResponse } from "next/server";
import { getState } from "@/lib/actions";
import { guarded } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded(async () => {
    const r = await getState(getStore());
    return NextResponse.json(r.body, { status: r.status });
  });
}
