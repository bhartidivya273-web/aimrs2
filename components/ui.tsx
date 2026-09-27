"use client";

import Link from "next/link";
import { PEOPLE, type PersonName, type StorageKind } from "@/lib/types";

export function StorageBanner({ storage }: { storage?: StorageKind }) {
  if (storage !== "memory") return null;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
      ⚠️ Storage not connected — data may reset
    </div>
  );
}

export function Header({ active }: { active: "intake" | "results" }) {
  const tab = (href: string, label: string, isActive: boolean) => (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
        isActive ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <header className="mb-4 flex items-center justify-between gap-2">
      <h1 className="text-lg font-bold tracking-tight">🧳 Group Trip</h1>
      <nav className="flex gap-1">
        {tab("/", "My preferences", active === "intake")}
        {tab("/results", "Results", active === "results")}
      </nav>
    </header>
  );
}

export function NamePicker({
  value,
  onChange,
  submitted = [],
  label = "Who are you?",
}: {
  value: PersonName | null;
  onChange: (n: PersonName) => void;
  submitted?: PersonName[];
  label?: string;
}) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-sm font-semibold text-slate-700">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {PEOPLE.map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-pressed={selected}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium transition ${
                selected
                  ? "border-teal-700 bg-teal-700 text-white"
                  : "border-slate-300 bg-white text-slate-800 hover:border-teal-600"
              }`}
            >
              {n}
              {submitted.includes(n) && <span className={selected ? "ml-1" : "ml-1 text-teal-700"}>✓</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</section>;
}
