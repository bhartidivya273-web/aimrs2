"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, Header, NamePicker, StorageBanner } from "@/components/ui";
import { useAppState, useRememberedName } from "@/components/client";
import { formatINR } from "@/lib/format";
import { MAX_DATE_RANGES } from "@/lib/validate";
import { DESTINATION_TYPES, type DestinationType, type PersonName, type PersonPreference } from "@/lib/types";

interface FormState {
  budgetMin: string;
  budgetMax: string;
  budgetHardCap: string;
  ranges: { start: string; end: string }[];
  ranking: DestinationType[];
  excluded: DestinationType[];
}

const EMPTY: FormState = {
  budgetMin: "",
  budgetMax: "",
  budgetHardCap: "",
  ranges: [{ start: "", end: "" }],
  ranking: [],
  excluded: [],
};

const TYPE_LABEL: Record<DestinationType, string> = { beach: "🏖️ Beach", mountains: "🏔️ Mountains", city: "🏙️ City" };

function fromRecord(p: PersonPreference): FormState {
  return {
    budgetMin: String(p.budgetMin),
    budgetMax: String(p.budgetMax),
    budgetHardCap: p.budgetHardCap === undefined ? "" : String(p.budgetHardCap),
    ranges: p.freeDateRanges.map((r) => ({ ...r })),
    ranking: [...p.destinationTypeRanking],
    excluded: [...(p.excludedDestinationTypes ?? [])],
  };
}

const toAmount = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/[,\s₹]/g, "")));

export default function IntakePage() {
  const router = useRouter();
  const { state, error: loadError } = useAppState();
  const [name, setName] = useRememberedName();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const existing = state?.preferences.find((p) => p.name === name);

  // Pre-fill when the chosen name or its saved version changes; a background refresh
  // with the same record must not wipe what someone is typing.
  const loaded = state !== null;
  const savedVersion = existing?.updatedAt;
  useEffect(() => {
    if (!loaded || !name) return;
    setForm(existing ? fromRecord(existing) : EMPTY);
    setErrors([]);
  }, [name, savedVersion, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const toggleRank = (t: DestinationType) =>
    update({ ranking: form.ranking.includes(t) ? form.ranking.filter((x) => x !== t) : [...form.ranking, t] });

  const toggleExclude = (t: DestinationType) =>
    form.excluded.includes(t)
      ? update({ excluded: form.excluded.filter((x) => x !== t) })
      : update({ excluded: [...form.excluded, t], ranking: form.ranking.filter((x) => x !== t) });

  const setRange = (i: number, key: "start" | "end", v: string) =>
    update({ ranges: form.ranges.map((r, j) => (j === i ? { ...r, [key]: v } : r)) });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return;
    const cap = toAmount(form.budgetHardCap);
    const body = {
      name,
      budgetMin: toAmount(form.budgetMin),
      budgetMax: toAmount(form.budgetMax),
      ...(Number.isNaN(cap) ? {} : { budgetHardCap: cap }),
      freeDateRanges: form.ranges,
      destinationTypeRanking: form.ranking,
      excludedDestinationTypes: form.excluded,
    };
    setSaving(true);
    setErrors([]);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(data.errors ?? ["Something went wrong. Try again."]);
        return;
      }
      router.push("/results");
    } catch {
      setErrors(["Couldn't save. Check your connection and try again."]);
    } finally {
      setSaving(false);
    }
  }

  const confirmedOn = existing?.confirmedOptionId
    ? state?.options.find((o) => o.id === existing.confirmedOptionId)?.destination
    : undefined;

  return (
    <>
      <Header active="intake" />
      <StorageBanner storage={state?.storage} />
      <p className="mb-4 text-sm text-slate-600">
        Pick your name, add your budget, free dates and what kind of trip you want. You can come back and edit any time.
      </p>
      {loadError && <p className="mb-4 text-sm text-red-700">{loadError}</p>}

      <NamePicker value={name} onChange={(n: PersonName) => setName(n)} submitted={state?.status.submitted} />

      {name && state && (
        <form onSubmit={submit} className="space-y-4">
          {existing && (
            <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900">
              Editing {name}&rsquo;s saved preferences.
            </p>
          )}

          <Card>
            <h2 className="mb-1 font-semibold">Budget per person</h2>
            <p className="mb-3 text-xs text-slate-500">Travel + stay, in ₹.</p>
            <div className="grid grid-cols-2 gap-3">
              <AmountField label="Comfortable from" value={form.budgetMin} onChange={(v) => update({ budgetMin: v })} required />
              <AmountField label="Up to" value={form.budgetMax} onChange={(v) => update({ budgetMax: v })} required />
            </div>
            <div className="mt-3">
              <AmountField
                label="Absolute max (optional dealbreaker)"
                value={form.budgetHardCap}
                onChange={(v) => update({ budgetHardCap: v })}
                placeholder={form.budgetMax ? `Blank = ${formatINR(toAmount(form.budgetMax) || 0)}` : "Blank = your “up to”"}
              />
              <p className="mt-1 text-xs text-slate-500">Any option above this is out for you. Blank means your “up to” amount is the limit.</p>
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold">When are you free?</h2>
            <p className="mb-3 text-xs text-slate-500">A trip must fit fully inside one of these ranges.</p>
            <div className="space-y-3">
              {form.ranges.map((r, i) => (
                <div key={i}>
                  {form.ranges.length > 1 && (
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">Range {i + 1}</span>
                      <button type="button" aria-label={`Remove date range ${i + 1}`}
                        onClick={() => update({ ranges: form.ranges.filter((_, j) => j !== i) })}
                        className="-my-2 px-2 py-2 text-xs font-medium text-red-700">
                        Remove
                      </button>
                    </div>
                  )}
                  {/* min-w-0: date inputs have a wide intrinsic size that overflows 320–375px phones */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="min-w-0 text-xs font-medium text-slate-600">
                      From
                      <input type="date" required value={r.start} onChange={(e) => setRange(i, "start", e.target.value)}
                        className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-base" />
                    </label>
                    <label className="min-w-0 text-xs font-medium text-slate-600">
                      To
                      <input type="date" required value={r.end} min={r.start || undefined} onChange={(e) => setRange(i, "end", e.target.value)}
                        className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-base" />
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" disabled={form.ranges.length >= MAX_DATE_RANGES}
              onClick={() => update({ ranges: [...form.ranges, { start: "", end: "" }] })}
              className="mt-3 text-sm font-medium text-teal-700 disabled:text-slate-400">
              + Add another date range
            </button>
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold">What kind of trip?</h2>
            <p className="mb-3 text-xs text-slate-500">Tap in order of preference (1st = favourite). You can leave some out.</p>
            <div className="flex flex-wrap gap-2">
              {DESTINATION_TYPES.map((t) => {
                const rank = form.ranking.indexOf(t);
                const excluded = form.excluded.includes(t);
                return (
                  <button key={t} type="button" disabled={excluded} onClick={() => toggleRank(t)} aria-pressed={rank >= 0}
                    className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
                      rank >= 0 ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white"
                    } disabled:opacity-40`}>
                    {rank >= 0 && <span className="mr-1 font-bold">#{rank + 1}</span>}
                    {TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
            {form.ranking.length > 0 && (
              <button type="button" onClick={() => update({ ranking: [] })} className="mt-2 text-xs text-slate-500 underline">
                Reset order
              </button>
            )}

            <h3 className="mb-2 mt-4 text-sm font-semibold">Dealbreakers: I won&rsquo;t go to a…</h3>
            <div className="flex flex-wrap gap-3">
              {DESTINATION_TYPES.map((t) => (
                <label key={t} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.excluded.includes(t)} onChange={() => toggleExclude(t)} className="h-5 w-5 accent-red-600" />
                  {TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </Card>

          {errors.length > 0 && (
            <ul role="alert" className="list-disc rounded-lg bg-red-50 py-2 pl-7 pr-3 text-sm text-red-800">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}

          {confirmedOn && (
            <p className="text-sm text-amber-800">
              Heads up: saving clears your &ldquo;I&rsquo;m in&rdquo; on {confirmedOn}. You can confirm again after.
            </p>
          )}

          <button type="submit" disabled={saving}
            className="min-h-12 w-full rounded-xl bg-teal-700 text-base font-semibold text-white shadow disabled:opacity-60">
            {saving ? "Saving…" : existing ? "Update my preferences" : "Save my preferences"}
          </button>
        </form>
      )}
    </>
  );
}

function AmountField({ label, value, onChange, required, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      {label}
      <div className="mt-1 flex items-center rounded-lg border border-slate-300 bg-white focus-within:border-teal-600">
        <span className="pl-3 text-slate-500">₹</span>
        <input inputMode="numeric" pattern="[0-9,]*" required={required} value={value} placeholder={placeholder}
          onChange={(e) => onChange(e.target.value.replace(/[^\d,]/g, ""))}
          className="w-full rounded-lg bg-transparent px-2 py-2 text-base outline-none" />
      </div>
    </label>
  );
}
