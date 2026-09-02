# RoofWise Learning Loop v2 — dataset, feedback, and model improvement

Owner directive (2026-09-02): keep every photo a user takes; build a large labelled
dataset of damaged shingles and roofs that records what the AI said AND every human
correction; make detection improve continuously; explain how real apps do this and
how a "global prompt release" works.

## 1 · How this is actually done in production apps (the honest version)

No shipping app has a model that "teaches itself" on the phone. The pattern every
serious vision product uses is a **human-in-the-loop training pipeline**:

1. **Capture everything, label by use.** Every photo is stored with the model's raw
   output. The user's normal actions — accept, reject, redraw a box, change a
   category — are recorded as labels. The app never asks for extra labelling work;
   doing the job *is* the labelling.
2. **A dataset, not a log.** Photos + boxes + categories + provenance (AI vs human)
   + context (material, storm, region, device) live in a queryable store with an
   export to a standard format (COCO). Quality gates keep bad labels out
   (confidence stars, inspector trust weight, agreement between inspectors).
3. **Periodic training, not continuous.** On a cadence (weekly/monthly) the dataset
   trains a new model version; it is evaluated against a held-out set and against
   the current model before anyone sees it (no regression = ship).
4. **Distribution without an app update.** Two channels: (a) model/prompt versions
   fetched at runtime from the backend; (b) a small on-device/edge model updated the
   same way. Apps like this treat "the prompt" and "the model" as versioned
   artefacts in a registry, released like code.
5. **Measure the loop.** Precision/recall per category per model version, correction
   rate per inspector, time-to-verdict. If the numbers don't move, the loop isn't
   learning, whatever the marketing says.

RoofWise today has step 1 partially (corrections recorded, per-user prompt prefix
after 20 corrections, per-category thresholds) and none of 2–5. Photos DO upload to
Supabase Storage when Supabase is configured (`inspection-photos/{user}/{inspection}/
{slope}/{n}.jpg`), but the analysis result and corrections are not stored beside them
in a dataset-shaped way, and corrections go to a separate Vercel endpoint.

## 2 · Yes: Supabase is the right place, and here is the schema

All in the owner's existing Supabase project (administered from the other workspace).
Row-level security: inspectors read/write their own rows; a `dataset` role (service
key, server-side only) reads everything for training exports. **The app never holds a
service key.**

```sql
-- One row per photo the app ever captures or imports.
create table photos (
  id uuid primary key,
  user_id uuid references auth.users not null,
  inspection_id text, slope_id text, photo_index int,
  storage_path text not null,                -- inspection-photos/…
  sha256 text not null,                      -- dedupe + integrity (already computed for reports)
  captured_at timestamptz not null,
  device text, app_version text,
  width int, height int, bytes int,
  lat double precision, lng double precision,  -- only with consent flag below
  area_tag text, capture_mode text,          -- 19 areas / square vs single shingle
  material text,                             -- from the job when known
  storm_context jsonb,                       -- nearest LSR hail/wind (date, size, distance)
  consent_dataset boolean not null default false,
  created_at timestamptz default now()
);

-- What the model said, every time it was asked (a photo can be analysed more than once).
create table detections (
  id uuid primary key,
  photo_id uuid references photos on delete cascade,
  model text not null,                       -- e.g. gemini-3.8-flash
  prompt_version text not null,              -- see prompt_releases
  ran_at timestamptz not null,
  latency_ms int,
  no_roof_detected boolean,
  shingle_scale jsonb,
  findings jsonb not null,                   -- [{category, severity, confidence, box_2d}]
  raw jsonb                                  -- the untouched model response
);

-- Every human action on a detection or photo — the labels.
create table labels (
  id uuid primary key,
  photo_id uuid references photos on delete cascade,
  detection_id uuid references detections,   -- null when the human added a marker the AI missed
  user_id uuid references auth.users not null,
  action text not null,                      -- accept | reject | edit_box | edit_category | add | remove | swipe_correct
  category text, severity text,
  box_2d int[4],                             -- the corrected box, 0-1000 scale
  confidence_stars smallint,
  inspector_trust_weight numeric default 1,
  source text not null,                      -- swipe_review | edit_detection | marker_layer
  created_at timestamptz default now()
);

-- Versioned prompt / model configuration the app fetches at launch.
create table prompt_releases (
  version text primary key,                  -- semver
  model text not null,
  system_prompt text not null,
  category_thresholds jsonb,                 -- per-category confidence floors
  few_shot_refs jsonb,                       -- storage paths of exemplar crops + labels
  eval jsonb,                                -- precision/recall vs held-out set at release time
  released_at timestamptz, released_by uuid, active boolean default false
);
```

Storage: keep `inspection-photos` for originals; add `dataset-crops` for labelled
crops (generated server-side from `labels.box_2d`) so few-shot retrieval and training
never touch customer originals directly.

## 3 · The three improvement mechanisms, in the order they pay off

**A. Few-shot retrieval (works now, no training).** At analysis time, pull the
inspector's (then the fleet's) best-labelled crops for the material/category in
play and send them with the photo as worked examples. Gemini improves immediately
on exactly the failure modes the inspectors corrected. Stored per release in
`prompt_releases.few_shot_refs`.

**B. Global prompt release channel (the question the owner asked).** Corrections are
aggregated on the backend (a Supabase Edge Function or the Vercel job) into
per-category precision/recall by model+prompt version. A human (or an agent) tunes
the shared prompt and thresholds, runs the eval, and inserts a new
`prompt_releases` row with `active = true`. **The app fetches the active release at
launch and caches it**, so every phone gets the improvement within a day with no
app update and no republish. (Correction to what was said in chat: EAS environment
variables are inlined at bundle time, so shipping through them would still need an
`eas update`; a runtime-fetched release is the right channel.)

**C. A trained model (the 12-month milestone).** Once `labels` holds tens of
thousands of boxes, train a detector (or tune a vision model via Vertex AI if
available for the current family) on the dataset, evaluate against a held-out set,
and serve it behind the same `prompt_releases` switch as an alternative
`model`. The app already treats the model name as configuration.

## 4 · Consent and data hygiene (not optional)

- `photos.consent_dataset` gated by an explicit setting the inspector turns on
  ("Help improve RoofWise's damage detection") plus the customer-facing line in the
  proposal/report terms. Photos without consent still sync for the inspector's own
  reports; they never enter `dataset-crops` or exports.
- Strip EXIF location from exports unless storm-context research consent is given;
  `lat/lng` stay in `photos` only under RLS.
- Faces/plates are rare on roof photos but the export job runs a blur pass anyway.
- Inspector trust weighting (`inspector_trust_weight`) is how bad labels are kept
  from poisoning the set — HAAG-certified inspectors' labels weigh more.

## 5 · What changes in the app (Wave L)

- `photoSync` uploads the analysis JSON beside every photo and inserts `photos` +
  `detections` rows; `correctionsSync` writes `labels` to Supabase (keeping the
  Vercel endpoint until the backend job moves).
- `gemini.ts` accepts a `PromptRelease` (system prompt, thresholds, few-shot refs) and
  records `prompt_version` on every result; `lib/services/promptRelease.ts` fetches
  the active release at boot with a cached fallback to the bundled prompt.
- Settings → "Improve detection" consent toggle + a Data page showing counts (photos
  contributed, labels, your accuracy) — real numbers only.
- A first backend job (Edge Function): nightly aggregate → `eval` table → the
  numbers that tell us whether the loop is learning.

What the owner provides: the Supabase project URL + anon key for the app (as already
planned), and a service-role key kept server-side for the export/aggregation job.
