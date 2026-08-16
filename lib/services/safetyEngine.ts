// Safety engine — pre-inspection go/no-go from the forecast. Pure function,
// NO I/O (Drift Warning #8). The caller fetches the forecast; this file only
// classifies it.
//
// AUTHORITY: docs/HAAG_DECISION_ENGINE.md §7:
//   SAFE        — wind < 20 mph, gusts < 25 mph, no rain, temp 40–90 °F
//   USE_CAUTION — wind 20–30 mph, gusts < 40 mph, slight rain (< 20% chance)
//   UNSAFE      — gusts ≥ 40 mph, any precipitation expected, temp < 35 or
//                 > 95 °F, thunderstorm watch
//
// Interpretation notes (kept conservative — a roofer's life is on the line):
// - "Any precipitation expected" (UNSAFE) is reconciled with USE_CAUTION's
//   "slight rain (< 20% chance)": chance ≥ 20% or an explicit
//   precipitation-expected flag rates UNSAFE; 0 < chance < 20% rates caution.
// - Sustained wind above the 30 mph USE_CAUTION ceiling has no spec row;
//   it rates UNSAFE rather than silently passing.
// - Missing inputs can never produce SAFE — they are listed in
//   `missing_inputs` and the rating degrades to USE_CAUTION unless a
//   confirmed UNSAFE condition exists (never silently assume, §9).

export type SafetyRating = 'SAFE' | 'USE_CAUTION' | 'UNSAFE';

export const SAFETY_RATING_LABELS: Record<SafetyRating, string> = {
  SAFE: 'Safe',
  USE_CAUTION: 'Use Caution',
  UNSAFE: 'Unsafe',
};

export type SafetyForecast = {
  /** Sustained wind, mph. */
  wind_mph?: number;
  /** Gusts, mph. */
  gust_mph?: number;
  /** Chance of precipitation, 0–100. */
  precip_chance_percent?: number;
  /** Explicit "precipitation expected" flag (e.g. rain in the forecast window). */
  precipitation_expected?: boolean;
  /** Temperature, °F. */
  temp_f?: number;
  /** Active thunderstorm watch. */
  thunderstorm_watch?: boolean;
};

export type SafetyResult = {
  rating: SafetyRating;
  /** Which §7 conditions produced the rating ("show its work"). */
  reasons: string[];
  /** Forecast fields that were not provided — rating cannot be SAFE with any missing. */
  missing_inputs: string[];
};

export function evaluateSafety(forecast: SafetyForecast = {}): SafetyResult {
  const { wind_mph, gust_mph, precip_chance_percent, precipitation_expected, temp_f, thunderstorm_watch } =
    forecast;

  const missing: string[] = [];
  if (wind_mph == null) missing.push('wind_mph');
  if (gust_mph == null) missing.push('gust_mph');
  if (precip_chance_percent == null && precipitation_expected == null) {
    missing.push('precip_chance_percent');
  }
  if (temp_f == null) missing.push('temp_f');
  if (thunderstorm_watch == null) missing.push('thunderstorm_watch');

  // --- UNSAFE conditions (§7) — any one confirmed condition rates UNSAFE.
  const unsafeReasons: string[] = [];
  if (gust_mph != null && gust_mph >= 40) {
    unsafeReasons.push(`Gusts ${gust_mph} mph ≥ 40 mph (HAAG §7 UNSAFE).`);
  }
  if (wind_mph != null && wind_mph > 30) {
    unsafeReasons.push(
      `Sustained wind ${wind_mph} mph exceeds the 30 mph USE_CAUTION ceiling (HAAG §7 — rated UNSAFE).`,
    );
  }
  if (precipitation_expected === true) {
    unsafeReasons.push('Precipitation expected (HAAG §7 UNSAFE).');
  }
  if (precip_chance_percent != null && precip_chance_percent >= 20) {
    unsafeReasons.push(
      `Precipitation chance ${precip_chance_percent}% — precipitation expected (HAAG §7 UNSAFE; ` +
        'only slight rain under 20% chance rates USE_CAUTION).',
    );
  }
  if (temp_f != null && (temp_f < 35 || temp_f > 95)) {
    unsafeReasons.push(`Temperature ${temp_f} °F outside 35–95 °F (HAAG §7 UNSAFE).`);
  }
  if (thunderstorm_watch === true) {
    unsafeReasons.push('Thunderstorm watch active (HAAG §7 UNSAFE).');
  }
  if (unsafeReasons.length > 0) {
    return { rating: 'UNSAFE', reasons: unsafeReasons, missing_inputs: missing };
  }

  // --- SAFE requires every §7 SAFE condition confirmed; missing data can't be SAFE.
  const safeConfirmed =
    missing.length === 0 &&
    wind_mph != null &&
    wind_mph < 20 &&
    gust_mph != null &&
    gust_mph < 25 &&
    (precip_chance_percent == null || precip_chance_percent === 0) &&
    precipitation_expected !== true &&
    temp_f != null &&
    temp_f >= 40 &&
    temp_f <= 90;

  if (safeConfirmed) {
    return {
      rating: 'SAFE',
      reasons: [
        `Wind ${wind_mph} mph < 20 mph, gusts ${gust_mph} mph < 25 mph, no rain, ` +
          `temperature ${temp_f} °F within 40–90 °F (HAAG §7 SAFE).`,
      ],
      missing_inputs: missing,
    };
  }

  // --- Otherwise USE_CAUTION, with the specific reasons.
  const cautionReasons: string[] = [];
  if (wind_mph != null && wind_mph >= 20) {
    cautionReasons.push(`Sustained wind ${wind_mph} mph in the 20–30 mph caution band (HAAG §7).`);
  }
  if (gust_mph != null && gust_mph >= 25) {
    cautionReasons.push(`Gusts ${gust_mph} mph ≥ 25 mph but under the 40 mph UNSAFE line (HAAG §7).`);
  }
  if (precip_chance_percent != null && precip_chance_percent > 0) {
    cautionReasons.push(`Slight rain — ${precip_chance_percent}% chance, under 20% (HAAG §7).`);
  }
  if (temp_f != null && (temp_f < 40 || temp_f > 90)) {
    cautionReasons.push(
      `Temperature ${temp_f} °F outside the 40–90 °F SAFE band but inside 35–95 °F (HAAG §7).`,
    );
  }
  for (const field of missing) {
    cautionReasons.push(`Forecast input missing: ${field} — SAFE cannot be confirmed without it.`);
  }
  if (cautionReasons.length === 0) {
    cautionReasons.push('Conditions could not be fully confirmed as SAFE (HAAG §7).');
  }

  return { rating: 'USE_CAUTION', reasons: cautionReasons, missing_inputs: missing };
}
