import { describe, expect, it } from "vitest";
import fixture from "@/data/test-preferences.json";
import { confirmChoice, submitPreferences } from "@/lib/actions";
import { createStore, memoryBackend, type HashBackend } from "@/lib/store-core";
import type { AppState } from "@/lib/state";
import { PEOPLE, type PersonPreference } from "@/lib/types";

const prefs = fixture.preferences as PersonPreference[];
const GOKARNA = "gokarna-dec04";

/** Memory backend whose writes to `gateKey` wait until `release()` is called. */
function gatedBackend(gateKey: string) {
  const inner = memoryBackend();
  let release!: () => void;
  let gate = new Promise<void>((r) => (release = r));
  let armed = false;
  const backend: HashBackend = {
    ...inner,
    async hset(key, field, value) {
      if (armed && key === gateKey) {
        armed = false;
        await gate;
      }
      return inner.hset(key, field, value);
    },
  };
  return {
    backend,
    arm() {
      armed = true;
      gate = new Promise<void>((r) => (release = r));
    },
    release: () => release(),
  };
}

/** Memory backend with random 0–3 ms latency on every call, to shake out interleavings. */
function jitteryBackend(seed: number): HashBackend {
  const inner = memoryBackend();
  const sleep = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return new Promise((r) => setTimeout(r, (seed % 4)));
  };
  return {
    hgetall: async (k) => (await sleep(), inner.hgetall(k)),
    hset: async (k, f, v) => (await sleep(), inner.hset(k, f, v)),
    hdel: async (k, f) => (await sleep(), inner.hdel(k, f)),
    del: async (...k) => (await sleep(), inner.del(...k)),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 5));
let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 1) + ++clock).toISOString();

async function seed(store: ReturnType<typeof createStore>) {
  for (const p of prefs) expect((await submitPreferences(store, p, now())).status).toBe(200);
}

describe("store: edit racing a confirm (the lost-update bug)", () => {
  it("confirm reads, edit saves, then confirm writes: edit survives and stale 'I'm in' is ignored", async () => {
    const g = gatedBackend("group-trip:confirmations");
    const store = createStore("memory", g.backend);
    await seed(store);

    g.arm();
    const pendingConfirm = confirmChoice(store, { name: "Riya", optionId: GOKARNA }); // reads, then blocks on write
    await flush();
    const edit = await submitPreferences(store, { ...prefs[0], budgetMin: 9500 }, now()); // runs fully meanwhile
    expect(edit.status).toBe(200);
    g.release();
    expect((await pendingConfirm).status).toBe(200);

    const riya = (await store.getAll()).find((p) => p.name === "Riya")!;
    expect(riya.budgetMin).toBe(9500); // edit not lost
    expect(riya.confirmedOptionId).toBeUndefined(); // confirmation was for the old version
  });

  it("a confirm made after the edit counts normally", async () => {
    const store = createStore("memory", memoryBackend());
    await seed(store);
    await submitPreferences(store, { ...prefs[0], budgetMin: 9500 }, now());
    await confirmChoice(store, { name: "Riya", optionId: GOKARNA });
    expect((await store.getAll()).find((p) => p.name === "Riya")!.confirmedOptionId).toBe(GOKARNA);
  });

  it("editing clears the stored confirmation", async () => {
    const store = createStore("memory", memoryBackend());
    await seed(store);
    for (const n of PEOPLE) await confirmChoice(store, { name: n, optionId: GOKARNA });
    let s = (await confirmChoice(store, { name: "Riya", optionId: GOKARNA })).body as AppState;
    expect(s.status.decidedOptionId).toBe(GOKARNA);
    s = (await submitPreferences(store, prefs[2], now())).body as AppState;
    expect(s.status.decidedOptionId).toBeNull();
    expect(s.status.confirmations[GOKARNA]).not.toContain("Karan");
  });
});

describe("store: random-latency concurrency", () => {
  it("parallel submits/confirms/back-outs never corrupt state", async () => {
    for (let round = 0; round < 30; round++) {
      const store = createStore("memory", jitteryBackend(round + 1));
      await Promise.all(prefs.map((p) => submitPreferences(store, p, now())));
      expect(await store.getAll()).toHaveLength(5);

      await Promise.all(PEOPLE.map((n) => confirmChoice(store, { name: n, optionId: GOKARNA })));
      const all = await store.getAll();
      expect(all.every((p) => p.confirmedOptionId === GOKARNA), `round ${round}`).toBe(true);

      // chaos: edits, back-outs and confirms at once
      const ops = [
        submitPreferences(store, { ...prefs[0], budgetMin: 9000 + round }, now()),
        confirmChoice(store, { name: "Karan", optionId: null }),
        confirmChoice(store, { name: "Aisha", optionId: GOKARNA }),
        submitPreferences(store, { ...prefs[4], budgetMin: 8500 }, now()),
        confirmChoice(store, { name: "Riya", optionId: GOKARNA }),
      ];
      const results = await Promise.all(ops);
      for (const r of results) expect(r.status).toBeLessThan(500);

      const final = await store.getAll();
      expect(final).toHaveLength(5);
      expect(final.find((p) => p.name === "Riya")!.budgetMin, `round ${round}`).toBe(9000 + round);
      expect(final.find((p) => p.name === "Preethi")!.budgetMin).toBe(8500);
      expect(final.find((p) => p.name === "Karan")!.confirmedOptionId).toBeUndefined();
      expect(final.find((p) => p.name === "Preethi")!.confirmedOptionId).toBeUndefined(); // edited, never re-confirmed
      const s = (await confirmChoice(store, { name: "Siddharth", optionId: GOKARNA })).body as AppState;
      expect(s.status.decidedOptionId).toBeNull();
    }
  });
});

describe("store: bad stored data", () => {
  it("ignores corrupt JSON, wrong names and prototype keys instead of crashing", async () => {
    const backend = memoryBackend();
    const store = createStore("memory", backend);
    await seed(store);
    await backend.hset("group-trip:preferences", "Bob", JSON.stringify({ ...prefs[0], name: "Bob" }));
    await backend.hset("group-trip:preferences", "Karan", "{not json");
    await backend.hset("group-trip:confirmations", "Riya", JSON.stringify({ optionId: "toString", version: "x" }));
    const all = await store.getAll();
    expect(all.map((p) => p.name)).toEqual(["Riya", "Siddharth", "Aisha", "Preethi"]);
  });

  it("Upstash-style auto-parsed objects are accepted", async () => {
    const inner = memoryBackend();
    const backend: HashBackend = {
      ...inner,
      async hgetall(k) {
        const h = await inner.hgetall(k);
        return h && Object.fromEntries(Object.entries(h).map(([f, v]) => [f, JSON.parse(v as string)]));
      },
    };
    const store = createStore("redis", backend);
    await seed(store);
    await confirmChoice(store, { name: "Riya", optionId: GOKARNA });
    const riya = (await store.getAll()).find((p) => p.name === "Riya")!;
    expect(riya.confirmedOptionId).toBe(GOKARNA);
  });
});

describe("decisionStatus with prototype-named ids", () => {
  it("doesn't crash on a stored confirmedOptionId like 'toString'", async () => {
    const { decisionStatus } = await import("@/lib/engine");
    const odd = prefs.map((p) => ({ ...p, confirmedOptionId: "toString" }));
    expect(() => decisionStatus(odd, ["gokarna-dec04"])).not.toThrow();
    expect(decisionStatus(odd, ["gokarna-dec04"]).decidedOptionId).toBeNull();
  });
});
