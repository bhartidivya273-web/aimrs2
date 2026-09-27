import "server-only";
import { createStore, memoryBackend, type PreferenceStore } from "./store-core";
import { createSupabaseStore } from "./supabase-store";

export type { PreferenceStore } from "./store-core";

// Survives dev hot reloads; resets on server restart / new serverless instance.
const g = globalThis as unknown as { __tripMemory?: Map<string, Map<string, string>> };

/**
 * Supabase when SUPABASE_URL + a server key are set (the Vercel Supabase integration
 * sets SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY); otherwise the in-memory fallback,
 * which the UI flags with "Storage not connected — data may reset".
 */
export function getStore(): PreferenceStore {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  return url && key
    ? createSupabaseStore(url, key)
    : createStore("memory", memoryBackend((g.__tripMemory ??= new Map())));
}
