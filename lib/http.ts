import "server-only";
import { NextResponse } from "next/server";

/** Runs a handler; storage/network failures become a JSON 503 the UI can show. */
export async function guarded(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    const error = "Couldn't reach the database. Try again in a moment.";
    return NextResponse.json({ error, errors: [error] }, { status: 503 });
  }
}
