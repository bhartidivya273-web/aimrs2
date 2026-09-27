"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, Header, NamePicker, StorageBanner } from "@/components/ui";
import { useAppState, useRememberedName } from "@/components/client";
import { describeElimination } from "@/lib/engine";
import { formatDateRange, formatINR } from "@/lib/format";
import type { AppState } from "@/lib/state";
import { PEOPLE, type OptionEliminations, type PersonName, type RankedOption, type TripOption } from "@/lib/types";

const TYPE_EMOJI = { beach: "🏖️", mountains: "🏔️", city: "🏙️" } as const;

function scoreColor(score: number) {
  if (score >= 85) return "bg-emerald-100 text-emerald-900";
  if (score >= 70) return "bg-lime-100 text-lime-900";
  if (score >= 50) return "bg-amber-100 text-amber-900";
  return "bg-red-100 text-red-900";
}

export default function ResultsPage() {
  const { state, setState, error: loadError } = useAppState(10_000);
  const [me, setMe] = useRememberedName();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function confirm(optionId: string | null) {
    if (!me) return;
    setBusy(optionId ?? "withdraw");
    setActionError(null);
    try {
      const res = await fetch("/api/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: me, optionId }),
      });
      const data = await res.json();
      if (!res.ok) setActionError(data.error ?? "Something went wrong.");
      else setState(data as AppState);
    } catch {
      setActionError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!state) {
    return (
      <>
        <Header active="results" />
        <p className="text-sm text-slate-500">{loadError ?? "Loading…"}</p>
      </>
    );
  }

  const { result, status } = state;
  const myRecord = state.preferences.find((p) => p.name === me);
  const decided = result.top.find((r) => r.option.id === status.decidedOptionId);
  // An "I'm in" on an option that has since dropped out of the top 3 doesn't count; say so.
  const staleConfirmation =
    myRecord?.confirmedOptionId && !result.top.some((r) => r.option.id === myRecord.confirmedOptionId)
      ? state.options.find((o) => o.id === myRecord.confirmedOptionId)?.destination ?? myRecord.confirmedOptionId
      : null;

  return (
    <>
      <Header active="results" />
      <StorageBanner storage={state.storage} />
      {loadError && <p className="mb-3 text-sm text-red-700">{loadError}</p>}

      {decided && (
        <div role="status" className="mb-4 rounded-xl bg-emerald-600 p-4 text-white shadow">
          <p className="text-xs font-semibold uppercase tracking-wider">Decided · 5 of 5 in</p>
          <p className="mt-1 text-2xl font-bold">
            {TYPE_EMOJI[decided.option.destinationType]} {decided.option.destination}
          </p>
          <p className="text-sm opacity-90">
            {formatDateRange(decided.option.start, decided.option.end)} · ~{formatINR(decided.option.estimatedCostPerPerson)} per person
          </p>
          <p className="mt-2 text-xs opacity-90">Nothing is booked. If anyone backs out here, this unlocks.</p>
        </div>
      )}

      <SubmissionStatus submitted={status.submitted} missing={status.missing} />

      {status.submitted.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">No one has submitted yet.</p>
          <Link href="/" className="mt-2 inline-block font-medium text-teal-700">Add your preferences →</Link>
        </Card>
      ) : result.top.length === 0 ? (
        <ZeroSurvivors groups={result.eliminatedOptions} />
      ) : (
        <>
          <NamePicker
            value={me}
            onChange={(n: PersonName) => setMe(n)}
            submitted={status.submitted}
            label="You are (to tap “I’m in”):"
          />
          {!status.allSubmitted && (
            <p className="mb-3 text-sm text-slate-500">&ldquo;I&rsquo;m in&rdquo; unlocks once all 5 have submitted.</p>
          )}
          {status.allSubmitted && !me && (
            <p className="mb-3 text-sm text-slate-500">Pick your name above to tap &ldquo;I&rsquo;m in&rdquo;.</p>
          )}
          {actionError && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{actionError}</p>}
          {staleConfirmation && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Your &ldquo;I&rsquo;m in&rdquo; was on {staleConfirmation}, which is no longer in the top options. Pick again below.
            </p>
          )}

          <div className="space-y-4">
            {result.top.map((r, i) => (
              <OptionCard
                key={r.option.id}
                rank={i + 1}
                ranked={r}
                inNames={status.confirmations[r.option.id] ?? []}
                me={me}
                myConfirmation={staleConfirmation ? undefined : myRecord?.confirmedOptionId}
                canConfirm={status.allSubmitted && !!myRecord}
                busy={busy}
                isDecided={status.decidedOptionId === r.option.id}
                onConfirm={confirm}
              />
            ))}
          </div>

          {result.eliminatedOptions.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm font-medium text-slate-600">
                Why the other {result.eliminatedOptions.length} options are out
              </summary>
              <div className="mt-3">
                <EliminationList groups={result.eliminatedOptions} />
              </div>
            </details>
          )}
        </>
      )}
    </>
  );
}

function SubmissionStatus({ submitted, missing }: { submitted: PersonName[]; missing: PersonName[] }) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{submitted.length} of {PEOPLE.length} submitted</span>
        {missing.length > 0 && <Link href="/" className="text-teal-700">Add yours →</Link>}
      </div>
      <div className="mt-2 flex gap-1.5" aria-hidden>
        {PEOPLE.map((n) => (
          <div key={n} className={`h-1.5 flex-1 rounded-full ${submitted.includes(n) ? "bg-teal-600" : "bg-slate-200"}`} />
        ))}
      </div>
      {missing.length > 0 && submitted.length > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Provisional</strong> — waiting on: {missing.join(", ")}
        </p>
      )}
    </div>
  );
}

function OptionCard({ rank, ranked, inNames, me, myConfirmation, canConfirm, busy, isDecided, onConfirm }: {
  rank: number;
  ranked: RankedOption;
  inNames: PersonName[];
  me: PersonName | null;
  myConfirmation?: string;
  canConfirm: boolean;
  busy: string | null;
  isDecided: boolean;
  onConfirm: (optionId: string | null) => void;
}) {
  const { option, scores, average, minimum } = ranked;
  const iAmIn = !!me && myConfirmation === option.id;
  return (
    <Card className={isDecided ? "ring-2 ring-emerald-500" : ""}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Option {rank}</p>
          <h2 className="text-xl font-bold">
            {TYPE_EMOJI[option.destinationType]} {option.destination}
          </h2>
          <p className="text-sm text-slate-600">{formatDateRange(option.start, option.end)}</p>
          <p className="text-sm text-slate-600">~{formatINR(option.estimatedCostPerPerson)} per person</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-3xl font-bold leading-none text-teal-700">{average.toFixed(1)}</p>
          <p className="text-xs text-slate-500">avg fit</p>
          <p className="mt-1 text-sm font-semibold">{minimum.score}</p>
          <p className="text-xs text-slate-500">lowest ({minimum.person})</p>
        </div>
      </div>

      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">Per-person fit for {option.destination}</caption>
        <tbody>
          {scores.map((s) => (
            <tr key={s.person} className="border-t border-slate-100 align-top">
              <th scope="row" className="py-2 pr-2 text-left font-medium">{s.person}</th>
              <td className="py-2 pr-2">
                <span className={`inline-block min-w-9 rounded px-1.5 py-0.5 text-center font-semibold ${scoreColor(s.score)}`}>{s.score}</span>
              </td>
              <td className="py-2 text-xs text-slate-600">{s.reason.split(" — ").slice(1).join(" — ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="mb-2 text-sm">
          <strong>{inNames.length} of {PEOPLE.length} in</strong>
          {inNames.length > 0 && `: ${inNames.join(", ")}`}
        </p>
        {iAmIn ? (
          <div className="flex gap-2">
            <span className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-emerald-50 font-semibold text-emerald-800">✓ You&rsquo;re in</span>
            <button type="button" disabled={busy !== null} onClick={() => onConfirm(null)}
              className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-medium disabled:opacity-50">
              Back out
            </button>
          </div>
        ) : (
          <button type="button" disabled={!canConfirm || !me || busy !== null} onClick={() => onConfirm(option.id)}
            className="min-h-11 w-full rounded-xl bg-teal-700 font-semibold text-white disabled:bg-slate-300">
            {busy === option.id ? "Saving…" : myConfirmation ? `Switch to ${option.destination}` : "I’m in"}
          </button>
        )}
      </div>
    </Card>
  );
}

function ZeroSurvivors({ groups }: { groups: OptionEliminations[] }) {
  return (
    <>
      <section className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
        <h2 className="font-semibold text-amber-900">No option works for everyone yet</h2>
        <p className="mt-1 text-sm text-amber-900">
          Every option breaks someone&rsquo;s dealbreaker. The closest ones are at the top: one change from one person could unlock them.
        </p>
        <Link href="/" className="mt-2 inline-block text-sm font-medium text-teal-800">Edit preferences →</Link>
      </section>
      <EliminationList groups={groups} />
    </>
  );
}

function optionLabel(o: TripOption) {
  return `${TYPE_EMOJI[o.destinationType]} ${o.destination} · ${formatDateRange(o.start, o.end)} · ${formatINR(o.estimatedCostPerPerson)}`;
}

function EliminationList({ groups }: { groups: OptionEliminations[] }) {
  return (
    <ul className="space-y-2">
      {groups.map(({ option, eliminations }) => (
        <li key={option.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <p className="font-medium">{optionLabel(option)}</p>
          {eliminations.length === 1 ? (
            <p className="mt-1 text-slate-700">
              Failed only on: <strong>{describeElimination(eliminations[0])}</strong>
            </p>
          ) : (
            <>
              <p className="mt-1 text-slate-600">Failed on {eliminations.length} constraints:</p>
              <ul className="mt-1 list-disc pl-5 text-slate-700">
                {eliminations.map((e) => <li key={`${e.person}-${e.rule}`}>{describeElimination(e)}</li>)}
              </ul>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
