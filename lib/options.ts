import seed from "@/data/trip-options.json";
import type { TripOption } from "./types";

/** Fixed seed list, loaded as-is. Not editable in the app. */
export const TRIP_OPTIONS: TripOption[] = seed.options as TripOption[];
