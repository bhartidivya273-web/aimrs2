import { mergeRecords, versionOf, type PreferenceStore, type StoredConfirmation } from "./store-core";
import type { PersonPreference } from "./types";

/**
 * Supabase store over PostgREST with plain fetch (no SDK dependency). Uses the
 * service-role / secret key, so it must only ever run on the server. Tables and the two
 * RPC functions are created by supabase/migrations/*_group_trip_storage.sql.
 */
export function createSupabaseStore(
  url: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): PreferenceStore {
  const base = `${url.replace(/\/+$/, "")}/rest/v1`;
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys don't.
  if (!key.startsWith("sb_")) headers.authorization = `Bearer ${key}`;

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Supabase ${init.method ?? "GET"} ${path} failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  const rpc = <T,>(fn: string, args: Record<string, unknown>) =>
    call<T>(`/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

  return {
    kind: "supabase",
    async getAll() {
      const [prefRows, confirmRows] = await Promise.all([
        call<{ name: string; data: PersonPreference; version: string }[]>(
          "/trip_preferences?select=name,data,version",
        ),
        call<{ name: string; option_id: string; version: string }[]>(
          "/trip_confirmations?select=name,option_id,version",
        ),
      ]);
      const prefs = Object.fromEntries(
        // the version column is authoritative; mergeRecords drops rows whose data.name != name
        (prefRows ?? []).map((r) => [r.name, r.data && ({ ...r.data, updatedAt: r.version } as PersonPreference)]),
      );
      const confirms = Object.fromEntries(
        (confirmRows ?? []).map((r) => [r.name, { optionId: r.option_id, version: r.version } satisfies StoredConfirmation]),
      );
      return mergeRecords(prefs, confirms);
    },
    async putPreference(pref) {
      const { confirmedOptionId: _drop, ...record } = pref;
      await rpc("save_trip_preference", { p_name: pref.name, p_data: record, p_version: versionOf(pref) });
    },
    async setConfirmation(name, optionId, version) {
      if (optionId === null) {
        await call(`/trip_confirmations?name=eq.${encodeURIComponent(name)}`, { method: "DELETE" });
      } else {
        // The database only accepts it if `version` is still current (checked atomically).
        await rpc("set_trip_confirmation", { p_name: name, p_option_id: optionId, p_version: version });
      }
    },
    async clear() {
      // Confirmations cascade-delete with their preference row.
      await call("/trip_preferences?name=not.is.null", { method: "DELETE" });
    },
  };
}
