# Knocking data in Supabase — the owner's view of every door

Owner's ask (2026-09-03): *"I want all of this data and more saved in Supabase
… see all of this compiled knocking data, map what every user has done, track
what doors were knocked, work that was done, claims, etc."*

This is the practical guide: what is stored, how to become the admin who sees
everyone, and the queries that answer the questions above. The schema is
`supabase/migrations/20260903140000_knocking_data.sql` (also appended to
`supabase/schema.sql`); the phone side is `lib/services/knockSync.ts`.

Project: `epghfumtuxrhonbpnbmr` (the only one).

---

## 1 · The model

Every table has `user_id` (who), the client's text `id`, a client-owned
`updated_at` (when the roofer last changed it — **never** rewritten by the
server), a server-owned `synced_at` (when it arrived), and `deleted_at` for
soft deletes. Nothing is ever hard-deleted by the app; the views hide
soft-deleted rows.

| Table | One row is… | Columns worth knowing |
|---|---|---|
| `profiles` | a user (filled from `auth.users` by trigger; the phone adds name + company) | `email`, `display_name`, `company` |
| `app_admins` | a user who may read everyone's rows | `user_id` — you add yourself once (§2) |
| `knock_sessions` | one door-knocking route | `started_at`, `ended_at`, `route_target` / `route_stops` (where it was aimed), `plan_id` (the Knock Plan it came from), `track` (walked path, ≤500 points), `miles`, `minutes`, and the day's numbers — `doors`, `contacts`, `interested`, `appointments`, `signed`, `follow_ups`, `leads` |
| `knocks` | one door | `lat`/`lng`, `address`, `outcome` (the 12 designations — `no_answer`, `interested`, `not_interested`, `follow_up`, `appointment`, `come_back`, `already_has_roofer`, `renter`, `vacant`, `inspected`, `signed`, `do_not_knock`; legacy `not_home` / `inspection_scheduled` read as the first two), `notes`, `follow_up_at`, `created_lead_id` (the pipeline lead it created or advanced), `contact_name` / `contact_phone` (**PII**), `damage_noted` (inspected doors: damage seen?), `come_back_when`, `placed_by` (`gps` / `map_tap`), `history` (earlier outcomes at this door), `property_record` (Zillow facts, no photos) |
| `knock_plans` | one Knock Planner run | `title`, `created_at`, `base` (where it searched from), `radius_miles`, `lookback_months`, `result` (the whole ranked result — areas, trip plan, brief), `area_status` (`{areaKey: planned/knocked/scheduled/skipped/done}`), `notes`, `schedule` (days put on the calendar), `storm_alert_id` (the Storm Watch alert that queued it), `exclusions` (what the do-not-knock list removed); `mode` is reserved |
| `knock_plan_areas` | one ranked area of a plan (flattened from `result.areas`) | `rank`, `name`, `zip`, `lat`/`lng`, `knock_score`, `per_roof_p` (P a roof carries claim-grade damage), `doors` (planned, 40), `expected`, `at_least` (80 % floor), `hail_max_inches`, `wind_max_mph`, `storm_day`, `status` |
| `do_not_knock` | a home or zone never to canvass | `kind` (`home` / `zone`), `label`, `lat`/`lng` + `radius_meters` or `polygon`, `source` (`roofer` / `outcome` / `hoa_list`), `knock_id` |

`leads`, `inspections` and `photos` already existed; this migration only adds
an **admin read** policy to them so the pipeline and the jobs show up next to
the doors.

### Helpers you can use in your own SQL

- `haversine_miles(lat1, lng1, lat2, lng2)` — great-circle miles (same
  constant as the app).
- `knock_is_contact(outcome)` / `knock_is_win(outcome)` — the same rules the
  app's stats bar uses.
- `app_local_day(ts)` — the calendar day in **America/Chicago**. Change the
  zone in that one function if the crew moves; every view reads it.
- `is_admin()` — true for rows in `app_admins`.

---

## 2 · Becoming the admin (once)

1. Supabase Dashboard → **Authentication → Users** → find your account → copy
   the **UID** (a uuid).
2. **SQL editor**, run:

   ```sql
   insert into public.app_admins (user_id, note) values ('<your uid>', 'owner');
   ```

3. Sign out and back in on the phone, or just query from the dashboard — the
   dashboard's SQL editor runs as the service role and sees everything anyway;
   `app_admins` matters for the **API** (the app, a BI tool with your
   anon-key + login, a Retool/Grafana panel) where RLS applies.

Anyone else you add there sees every user's rows read-only. Nobody can add
themselves: the table has no insert policy for clients.

---

## 3 · The queries

All of these are plain `select`s in the SQL editor. Every view respects RLS:
an admin sees all users, a roofer sees only themselves.

### Every door knocked, on a map

```sql
select * from public.v_knock_doors order by knocked_at desc;
```

Columns: who (`email`, `display_name`, `company`), when (`knocked_at`,
`knocked_on`), where (`lat`, `lng`, `address`), what (`outcome`,
`is_contact`, `is_win`, `damage_noted`, `notes`, `follow_up_at`,
`created_lead_id`, `prior_visits`), the route (`session_id`,
`session_started_at`) and the plan (`plan_title`), plus `year_built` /
`home_status` from the Zillow record when the roofer looked the house up.

**To see it on a map** — GeoJSON in one call:

```sql
select public.knock_doors_geojson();                 -- last 90 days
select public.knock_doors_geojson('2026-06-01');     -- since a date
select public.knock_doors_geojson('2000-01-01');     -- everything
```

Copy the result cell (the SQL editor shows it as JSON), paste into
[geojson.io](https://geojson.io) or drop it into [kepler.gl](https://kepler.gl)
/ QGIS. Each point carries `user`, `outcome`, `address`, `knocked_at`,
`plan`, `lead_id`, `damage_noted`. In kepler.gl colour by `outcome` and
filter by `user`.

The dashboard's **Download CSV** button on any query result gives the same
data for Google My Maps / Excel.

### Per user — what each person has done

```sql
select * from public.v_user_activity order by doors desc;
```

Sessions, doors, contacts, interested / appointments / signed, follow-ups,
leads, miles, minutes, `contact_rate_pct`, `first_active`, `last_active`,
`last_synced`.

### Per user per day

```sql
select * from public.v_daily_activity
 where day >= current_date - 30
 order by day desc, doors desc;
```

### Which plan areas actually produced (expected vs. found)

```sql
select plan_title, name, zip, knock_score, per_roof_p,
       doors, contacts, damage_confirmed, leads, appointments, signed,
       expected_at_doors_knocked, damage_rate_pct, status
  from public.v_area_performance
 order by plan_created_at desc, rank;
```

`doors` counts every knock by the same user within 3 miles of the area's
centre since the plan was created; `expected_at_doors_knocked` is
`per_roof_p × doors`; `damage_confirmed` (inspected + damage seen) is the
observed count. Where the two diverge over enough doors, the formula's base
rates (`docs/KNOCK_OPPORTUNITIES.md` §4.1, §8) get refit — this view is that
input, server-side.

### The claims pipeline — leads, the jobs they became, the verdicts

```sql
select display_name, customer_name, address, stage, from_knock, knock_count,
       report_id, inspection_kind, carrier, claim_number, date_of_loss,
       recommendation, claim_viability, safety_rating, report_finalized_at,
       proposal_status
  from public.v_claims_pipeline
 order by lead_updated_at desc;
```

`from_knock` is true when the lead came from a door (`source = 'door_knock'`
or a knock points at it). The verdict columns are the HAAG engine result
frozen on the job (`roofwise_recommendation`, `claim_viability`,
`roofer_safety_rating`). `proposal_status` is derived from the lead stage
(`sent` / `signed`) — proposals have no table of their own yet.

Every job, lead or not: `select * from public.v_inspection_verdicts`.

### Do-not-knock list

```sql
select display_name, kind, label, address, source, note, created_at
  from public.do_not_knock d left join public.profiles p using (user_id)
 where deleted_at is null;
```

### Ad-hoc examples

```sql
-- Doors within a mile of a point
select address, outcome, knocked_at
  from public.v_knock_doors
 where public.haversine_miles(lat, lng, 33.0198, -96.6989) <= 1;

-- Contact rate by hour of day (best time to knock)
select extract(hour from knocked_at at time zone 'America/Chicago') as hour,
       count(*) as doors,
       round(100.0 * count(*) filter (where is_contact) / count(*)) as contact_pct
  from public.v_knock_doors
 group by 1 order by 1;

-- Follow-ups due this week, by roofer
select display_name, address, contact_name, follow_up_at
  from public.v_knock_doors
 where follow_up_at between now() and now() + interval '7 days'
 order by follow_up_at;
```

### CSV export

Any query → **Download CSV** in the SQL editor's result pane. For a scheduled
export, a Supabase Edge Function or a nightly `pg_dump` of the six tables
with the service-role key is the next step; nothing in the app needs it.

---

## 4 · How the sync works (so you know what you're looking at)

- Runs on the phone every 5 minutes in the foreground while signed in, ~20 s
  after a route ends / a door is logged / a plan is saved or changed, and
  from Settings → Backup & Restore → Knocking data → **Sync now**.
- Pushes the archive **and the active route** (so a day in progress is
  visible), the doors, the plans (+ areas), the do-not-knock list and the
  user's name/company into `profiles`. Only rows whose content changed are
  sent (a per-row hash on the phone).
- Pulls back anything the phone has never seen — a **new phone restores its
  sessions, plans and do-not-knock list** on first sync — and plan / entry
  edits made later on another device. Ties go to the device.
- Deleting a plan or an entry on the phone stamps `deleted_at` on the server
  and it is never handed back. Sessions are never deleted on the server:
  the phone keeps 100, the server keeps all.
- `synced_at` tells you when a row last arrived; `updated_at` is when the
  roofer last touched it.
- If the tables are missing the app says so in Settings → Backup ("Copy SQL")
  — the same text as the migration file.

---

## 5 · Privacy and retention — decide these

- **PII.** `knocks.contact_name` and `contact_phone` are names and numbers
  homeowners gave at the door; `knocks.notes` is free text and can contain
  anything the roofer typed; `leads` already holds customer contacts. Treat
  the project as containing personal data: restrict who is in `app_admins`,
  keep the service-role key server-side (it is the only thing that bypasses
  RLS), and say in the app's privacy policy that door outcomes and contact
  details are stored with the company.
- **Retention.** Nothing expires. Suggested: keep doors and sessions for
  the statute-of-limitations horizon on the claims they led to (2–3 years),
  then either delete or strip `contact_name` / `contact_phone` / `notes`
  (`update public.knocks set contact_name = null, contact_phone = null,
  notes = null where created_at < now() - interval '3 years'`). Plans can go
  after a season. Pick a rule and put it in a scheduled function.
- **Location tracks.** `knock_sessions.track` is the roofer's walked path
  during the route (foreground only, thinned to ≤500 points). It exists for
  the map and mileage; if that is more than the company wants to hold, drop
  the column from the push (`sessionToRow`) — everything else still works.
- **A user's deletion.** Every table cascades from `auth.users`: deleting the
  auth user removes all their rows.

---

## 6 · What is NOT synced (on purpose)

- **Photos of pins** — none exist; a knock has no photo today.
- **Zillow photo URLs and the listing agent** — `knocks.property_record` is
  a subset (address, zpid, year built, living area, status, prices, listed /
  sold dates, roof hints). Licensed imagery and a third party's contact
  details stay on the phone.
- **Mileage trips** — the session carries `miles`; the raw trip samples are
  device detail (Reports exports mileage as CSV already).
- **Proposals / estimates** — no Supabase table yet; `proposal_status` in the
  pipeline view is derived from the lead stage.
- **Housing-profile cache, notification history, activity feed** — device
  conveniences.
