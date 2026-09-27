import { decisionStatus, runEngine } from "./engine";
import { TRIP_OPTIONS } from "./options";
import type { DecisionStatus, EngineResult, PersonPreference, StorageKind, TripOption } from "./types";

export interface AppState {
  storage: StorageKind;
  options: TripOption[];
  preferences: PersonPreference[];
  result: EngineResult;
  status: DecisionStatus;
}

export function buildState(storage: StorageKind, preferences: PersonPreference[]): AppState {
  const result = runEngine(TRIP_OPTIONS, preferences);
  const status = decisionStatus(preferences, result.top.map((r) => r.option.id));
  return { storage, options: TRIP_OPTIONS, preferences, result, status };
}
