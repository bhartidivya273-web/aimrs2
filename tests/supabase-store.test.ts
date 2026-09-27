import { describe, expect, it } from "vitest";
import fixture from "@/data/test-preferences.json";
import { confirmChoice, submitPreferences } from "@/lib/actions";
import type { AppState } from "@/lib/state";
import { createSupabaseStore } from "@/lib/supabase-store";
import { PEOPLE, type PersonPreference } from "@/lib/types";

const prefs = fixture.preferences as PersonPreference[];
const GOKARNA = "gokarna-dec04";
let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 1) + ++clock).toISOString();

/**
 * Tiny in-memory stand-in for the PostgREST endpoints the store uses, with the same
 * semantics as the SQL in supabase/migrations (version-checked confirm, cascade delete).
 */
function fakePostgrest() {
  const prefsT = new Map<string, { name: string; data: unknown; version: string }>();
  const confT = new Map<string, { name: string; option_id: string; version: string }>();
  const calls: { method: string; path: string; headers: Record<string, string> }[] = [];
  const json = (v: unknown, status = 200) => new Response(v === undefined ? null : JSON.stringify(v), { status });

  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(input));
    const path = u.pathname.replace("/rest/v1", "");
    const method = init.method ?? "GET";
    calls.push({ method, path: path + u.search, headers: init.headers as Record<string, string> });
    const body = init.body ? JSON.parse(String(init.body)) : null;

    if (method === "GET" && path === "/trip_preferences") return json([...prefsT.values()]);
    if (method === "GET" && path === "/trip_confirmations") return json([...confT.values()]);
    if (method === "POST" && path === "/rpc/save_trip_preference") {
      prefsT.set(body.p_name, { name: body.p_name, data: body.p_data, version: body.p_version });
      confT.delete(body.p_name);
      return json(undefined, 204);
    }
    if (method === "POST" && path === "/rpc/set_trip_confirmation") {
      const ok = prefsT.get(body.p_name)?.version === body.p_version;
      if (ok) confT.set(body.p_name, { name: body.p_name, option_id: body.p_option_id, version: body.p_version });
      return json(ok);
    }
    if (method === "DELETE" && path === "/trip_confirmations") {
      confT.delete(decodeURIComponent(u.searchParams.get("name")!.replace(/^eq\./, "")));
      return json(undefined, 204);
    }
    if (method === "DELETE" && path === "/trip_preferences") {
      prefsT.clear();
      confT.clear();
      return json(undefined, 204);
    }
    return json({ message: "not found" }, 404);
  }) as typeof fetch;

  return { fetchImpl, prefsT, confT, calls };
}

describe("Supabase store (against a fake PostgREST)", () => {
  it("round-trips the fixture and the 5-of-5 lock", async () => {
    const db = fakePostgrest();
    const store = createSupabaseStore("https://x.supabase.co/", "legacy.jwt.key", db.fetchImpl);
    for (const p of prefs) expect((await submitPreferences(store, p, now())).status).toBe(200);

    const all = await store.getAll();
    expect(all.map((p) => p.name)).toEqual([...PEOPLE]);
    for (const p of prefs) {
      const { updatedAt: _u, ...got } = all.find((x) => x.name === p.name)!;
      expect(got).toEqual({ excludedDestinationTypes: [], ...p });
    }

    let s!: AppState;
    for (const n of PEOPLE) s = (await confirmChoice(store, { name: n, optionId: GOKARNA })).body as AppState;
    expect(s.status.decidedOptionId).toBe(GOKARNA);

    s = (await confirmChoice(store, { name: "Karan", optionId: null })).body as AppState;
    expect(s.status.decidedOptionId).toBeNull();
    expect(db.confT.has("Karan")).toBe(false);
  });

  it("editing preferences clears the confirmation row", async () => {
    const db = fakePostgrest();
    const store = createSupabaseStore("https://x.supabase.co", "k", db.fetchImpl);
    for (const p of prefs) await submitPreferences(store, p, now());
    await confirmChoice(store, { name: "Riya", optionId: GOKARNA });
    expect(db.confT.has("Riya")).toBe(true);
    await submitPreferences(store, { ...prefs[0], budgetMin: 9000 }, now());
    expect(db.confT.has("Riya")).toBe(false);
  });

  it("a stale confirm (version changed) is rejected by the database and ignored on read", async () => {
    const db = fakePostgrest();
    const store = createSupabaseStore("https://x.supabase.co", "k", db.fetchImpl);
    for (const p of prefs) await submitPreferences(store, p, now());
    await store.setConfirmation("Riya", GOKARNA, "some-old-version");
    expect(db.confT.has("Riya")).toBe(false);
    // even if a stale row existed, reads ignore it
    db.confT.set("Riya", { name: "Riya", option_id: GOKARNA, version: "old" });
    expect((await store.getAll()).find((p) => p.name === "Riya")!.confirmedOptionId).toBeUndefined();
  });

  it("never stores confirmedOptionId inside the preferences row", async () => {
    const db = fakePostgrest();
    const store = createSupabaseStore("https://x.supabase.co", "k", db.fetchImpl);
    await store.putPreference({ ...prefs[0], confirmedOptionId: GOKARNA, updatedAt: "v1" });
    expect(db.prefsT.get("Riya")!.data).not.toHaveProperty("confirmedOptionId");
  });

  it("clear() wipes both tables", async () => {
    const db = fakePostgrest();
    const store = createSupabaseStore("https://x.supabase.co", "k", db.fetchImpl);
    for (const p of prefs) await submitPreferences(store, p, now());
    await confirmChoice(store, { name: "Riya", optionId: GOKARNA });
    await store.clear();
    expect(await store.getAll()).toEqual([]);
    expect(db.confT.size).toBe(0);
  });

  it("sends the right auth headers for legacy JWT vs new sb_secret keys", async () => {
    const legacy = fakePostgrest();
    await createSupabaseStore("https://x.supabase.co", "eyJ.legacy", legacy.fetchImpl).getAll();
    expect(legacy.calls[0].headers).toMatchObject({ apikey: "eyJ.legacy", authorization: "Bearer eyJ.legacy" });

    const modern = fakePostgrest();
    await createSupabaseStore("https://x.supabase.co", "sb_secret_abc", modern.fetchImpl).getAll();
    expect(modern.calls[0].headers).toMatchObject({ apikey: "sb_secret_abc" });
    expect(modern.calls[0].headers).not.toHaveProperty("authorization");
  });

  it("surfaces HTTP errors instead of silently returning nothing", async () => {
    const failing = (async () => new Response('{"message":"JWT expired"}', { status: 401 })) as typeof fetch;
    await expect(createSupabaseStore("https://x.supabase.co", "k", failing).getAll()).rejects.toThrow(/401/);
  });

  it("drops rows with unknown names or missing data", async () => {
    const db = fakePostgrest();
    const store = createSupabaseStore("https://x.supabase.co", "k", db.fetchImpl);
    await submitPreferences(store, prefs[0], now());
    db.prefsT.set("Bob", { name: "Bob", data: { ...prefs[0], name: "Bob" }, version: "v" });
    db.prefsT.set("Karan", { name: "Karan", data: null, version: "v" });
    expect((await store.getAll()).map((p) => p.name)).toEqual(["Riya"]);
  });
});

/**
 * Live check against the real Supabase project. Opt-in only, because it writes and then
 * wipes the tables: SUPABASE_LIVE_TEST=1 with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Refuses to run if the tables already hold data, so it can never wipe real submissions.
 */
const live = process.env.SUPABASE_LIVE_TEST === "1" && process.env.SUPABASE_URL;
describe.runIf(live)("Supabase store (LIVE)", () => {
  it("full flow against the real database, then cleans up", async () => {
    const store = createSupabaseStore(
      process.env.SUPABASE_URL!,
      (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY)!,
    );
    expect(await store.getAll(), "tables must be empty before a live test").toEqual([]);
    try {
      for (const p of prefs) expect((await submitPreferences(store, p, now())).status).toBe(200);
      let s = (await confirmChoice(store, { name: "Riya", optionId: GOKARNA })).body as AppState;
      expect(s.result.top.map((r) => [r.option.id, Number(r.average.toFixed(1)), r.minimum.score])).toEqual(
        fixture.expected.ranking.map((r) => [r.id, r.average, r.minimum]),
      );
      for (const n of PEOPLE.slice(1)) s = (await confirmChoice(store, { name: n, optionId: GOKARNA })).body as AppState;
      expect(s.status.decidedOptionId).toBe(GOKARNA);

      // stale confirm rejected by the SQL function
      await store.setConfirmation("Riya", "udaipur-nov20", "stale-version");
      expect((await store.getAll()).find((p) => p.name === "Riya")!.confirmedOptionId).toBe(GOKARNA);

      // edit clears the confirmation and unlocks
      s = (await submitPreferences(store, { ...prefs[0], budgetMin: 9000 }, now())).body as AppState;
      expect(s.status.decidedOptionId).toBeNull();
      expect(s.preferences.find((p) => p.name === "Riya")!.budgetMin).toBe(9000);

      // concurrent submits and confirms
      await Promise.all([
        ...PEOPLE.map((n) => confirmChoice(store, { name: n, optionId: GOKARNA })),
        submitPreferences(store, { ...prefs[4], budgetMin: 8500 }, now()),
      ]);
      const final = await store.getAll();
      expect(final).toHaveLength(5);
      expect(final.find((p) => p.name === "Preethi")!.budgetMin).toBe(8500);
    } finally {
      await store.clear();
      expect(await store.getAll()).toEqual([]);
    }
  }, 60_000);
});
