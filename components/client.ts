"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppState } from "@/lib/state";
import { isPersonName } from "@/lib/validate";
import type { PersonName } from "@/lib/types";

/** Fetches /api/state; re-fetches on window focus and every `pollMs` (0 = never). */
export function useAppState(pollMs = 0) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState(await res.json());
      setError(null);
    } catch {
      setError("Couldn't load the latest data. Check your connection.");
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    const id = pollMs > 0 ? window.setInterval(refresh, pollMs) : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      if (id) window.clearInterval(id);
    };
  }, [refresh, pollMs]);

  return { state, setState, error, refresh };
}

const NAME_KEY = "group-trip:me";

/** Remembers which friend is using this phone. Convenience only; safe if storage is blocked. */
export function useRememberedName(): [PersonName | null, (n: PersonName) => void] {
  const [name, setName] = useState<PersonName | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (isPersonName(saved)) setName(saved);
    } catch {}
  }, []);
  const set = useCallback((n: PersonName) => {
    setName(n);
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {}
  }, []);
  return [name, set];
}
