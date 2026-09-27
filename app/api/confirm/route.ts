import { NextResponse, type NextRequest } from "next/server";
import { confirmChoice } from "@/lib/actions";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const r = await confirmChoice(getStore(), body);
  return NextResponse.json(r.body, { status: r.status });
}
