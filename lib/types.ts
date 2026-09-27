export const PEOPLE = ["Riya", "Siddharth", "Karan", "Aisha", "Preethi"] as const;
export type PersonName = (typeof PEOPLE)[number];

export type StorageKind = "redis" | "memory";

export const DESTINATION_TYPES = ["beach", "mountains", "city"] as const;
export type DestinationType = (typeof DESTINATION_TYPES)[number];

/** Inclusive ISO date range, "YYYY-MM-DD". */
export interface DateRange {
  start: string;
  end: string;
}

export interface PersonPreference {
  name: PersonName;
  budgetMin: number;
  budgetMax: number;
  /** Dealbreaker. Defaults to budgetMax when absent. */
  budgetHardCap?: number;
  freeDateRanges: DateRange[];
  /** 1st = most preferred. May omit types. */
  destinationTypeRanking: DestinationType[];
  excludedDestinationTypes?: DestinationType[];
  confirmedOptionId?: string;
  updatedAt?: string;
}

/** What the intake form submits: everything except server-managed fields. */
export type PreferenceInput = Omit<PersonPreference, "confirmedOptionId" | "updatedAt">;

export interface TripOption {
  id: string;
  destination: string;
  destinationType: DestinationType;
  start: string;
  end: string;
  estimatedCostPerPerson: number;
}

export type EliminationRule = "dates" | "budget" | "type";

export interface Elimination {
  optionId: string;
  person: PersonName;
  rule: EliminationRule;
  detail: string;
}

export interface PersonScore {
  person: PersonName;
  score: number;
  budgetFit: number;
  destinationFit: number;
  reason: string;
}

export interface RankedOption {
  option: TripOption;
  scores: PersonScore[];
  average: number;
  minimum: { score: number; person: PersonName };
}

export interface OptionEliminations {
  option: TripOption;
  eliminations: Elimination[];
}

export interface EngineResult {
  /** All survivors, ranked. */
  ranked: RankedOption[];
  /** Top 3 (or fewer) of `ranked`: the options shown and confirmable. */
  top: RankedOption[];
  eliminations: Elimination[];
  /** Every eliminated option with its eliminations, fewest first. */
  eliminatedOptions: OptionEliminations[];
}

export interface DecisionStatus {
  submitted: PersonName[];
  missing: PersonName[];
  allSubmitted: boolean;
  /** optionId -> names that tapped "I'm in", in PEOPLE order. */
  confirmations: Record<string, PersonName[]>;
  decidedOptionId: string | null;
}
