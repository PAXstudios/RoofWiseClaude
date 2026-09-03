// The AI brief for "Where should I knock?" — Gemini writes the words, the
// engine owns the numbers. Network I/O.
//
// The model is handed the ranked areas WITH their computed facts (storm
// dates and sizes, report counts, housing profile, distance, expected finds)
// and asked to phrase a rationale per area, a headline, and a plan
// narrative — using only those facts. It is not asked to score, rank, or
// estimate anything; if it returns a number that is not in its input the
// UI still shows the engine's figures, never the model's. Unavailable →
// null, and the screen shows the rule-based rationale labelled as such.

import {
  GeminiAnalysisError,
  GeminiNotConfiguredError,
  extractGeminiText,
  geminiGenerateContent,
} from './gemini';
import { isGeminiConfigured } from '../env';
import type { BasePoint, ScoredArea, TripPlan } from './knockOpportunities';

export type OpportunityBrief = {
  headline: string;
  areas: { key: string; rationale: string; opener: string }[];
  planNarrative: string;
  modelUsed: string;
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    areas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' },
          rationale: { type: 'STRING' },
          opener: { type: 'STRING' },
        },
        required: ['key', 'rationale', 'opener'],
      },
    },
    planNarrative: { type: 'STRING' },
  },
  required: ['headline', 'areas', 'planNarrative'],
};

function areaFacts(a: ScoredArea): Record<string, unknown> {
  return {
    key: a.key,
    name: a.name ?? a.storm.town ?? 'Unnamed area',
    knockScore: a.knockScore,
    distanceMiles: Math.round(a.distanceMiles),
    bearing: a.bearing,
    driveMinutes: Math.round(a.driveMinutes),
    storm: {
      maxHailInches: a.storm.maxHailInches,
      maxWindMph: a.storm.maxWindMph,
      hailReports: a.storm.hailReports,
      windReports: a.storm.windReports,
      reportLandedInArea: a.storm.direct,
      strongestDay: a.storm.strongest,
      monthsSinceStrongest: a.storm.monthsSinceStrongest == null ? null : Math.round(a.storm.monthsSinceStrongest),
      otherDays: a.storm.days.slice(0, 4),
    },
    housing: a.housing,
    expected: {
      doors: a.hitRate.doors,
      expectedClaimGradeRoofs: a.hitRate.expected,
      atLeastWithConfidence: a.hitRate.atLeast,
      confidence: a.hitRate.confidence,
      chanceOfAtLeastTarget: Math.round(a.hitRate.pAtLeastTarget * 100),
      target: a.hitRate.target,
    },
    yourJobsHere: a.ownJobs,
    yourKnocksLast60Days: a.recentKnocks,
    ruleRationale: a.reasons,
  };
}

export async function writeOpportunityBrief(args: {
  base: BasePoint;
  areas: ScoredArea[];
  plan: TripPlan;
  signal?: AbortSignal;
}): Promise<OpportunityBrief | null> {
  if (!isGeminiConfigured || args.areas.length === 0) return null;

  const prompt =
    'You are the sales strategist for a roofing contractor who files hail and wind insurance claims. ' +
    'Below are door-knocking areas already SCORED by our engine from NWS storm reports, Census housing data and drive distance. ' +
    'Write, for each area, a 2–3 sentence rationale a roofer can act on — why go, what to look for at the door ' +
    '(soft-metal dents on gutters, downspouts, AC fins, mailboxes; granule piles at downspout outlets), and what to say. ' +
    'Also write a one-line headline for the whole search and a short plan narrative for the trip plan. ' +
    'RULES: use ONLY the numbers and facts given — never estimate, round differently, or add storms, dates, hail sizes, ' +
    'percentages or counts that are not in the input. Do not mention scores as if they were probabilities. ' +
    'Where housing is marked national_prior, say the neighbourhood data was unavailable. Plain language, no hype, no emojis. ' +
    'Return JSON matching the schema with one entry per area key, in the same order.\n\n' +
    `BASE: ${args.base.label} (${args.base.lat.toFixed(4)}, ${args.base.lng.toFixed(4)})\n` +
    `AREAS: ${JSON.stringify(args.areas.map(areaFacts))}\n` +
    `PLAN: ${JSON.stringify(
      args.plan.days.map((d) => ({
        day: d.day,
        stops: d.stops.map((s) => ({ key: s.area.key, name: s.area.name ?? s.area.storm.town, doors: s.doors, driveMiles: Math.round(s.driveMiles) })),
        totalMiles: Math.round(d.totalMiles),
        totalMinutes: Math.round(d.totalMinutes),
        expected: d.expected,
        atLeast: d.atLeast,
      })),
    )}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.3,
    },
  };

  try {
    const { json, modelUsed } = await geminiGenerateContent(body, { signal: args.signal, timeoutMs: 45_000 });
    const text = extractGeminiText(json, modelUsed);
    const parsed = JSON.parse(text) as Partial<OpportunityBrief>;
    if (!parsed || typeof parsed.headline !== 'string' || !Array.isArray(parsed.areas)) return null;
    const known = new Set(args.areas.map((a) => a.key));
    return {
      headline: parsed.headline.trim(),
      areas: parsed.areas
        .filter((a) => a && typeof a.key === 'string' && known.has(a.key) && typeof a.rationale === 'string')
        .map((a) => ({ key: a.key, rationale: a.rationale.trim(), opener: typeof a.opener === 'string' ? a.opener.trim() : '' })),
      planNarrative: typeof parsed.planNarrative === 'string' ? parsed.planNarrative.trim() : '',
      modelUsed,
    };
  } catch (e) {
    if (e instanceof GeminiNotConfiguredError || e instanceof GeminiAnalysisError) return null;
    if (e instanceof SyntaxError) return null;
    return null;
  }
}
