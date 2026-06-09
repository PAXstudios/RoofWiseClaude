# Contributing to RoofWise

> **This file is the contract for any AI agent (or human) making changes to this project.** Read it in full before touching code.

RoofWise is a context-engineered project. The single source of truth for *intent, scope, and history* is [`PROMPT_LOG.md`](./PROMPT_LOG.md). Code is downstream of that log — if the log and the code disagree, the log wins until a new prompt resolves it.

---

## The 3 Rules for AI Agents

If you are an AI agent (Claude, GPT, Cursor, etc.) opening this project, you **must** follow these three rules on every change. No exceptions.

### Rule 1 — Read `PROMPT_LOG.md` *first*

Before making **any** change to this codebase:

1. Open `PROMPT_LOG.md` and read, at minimum:
   - The **Context Summary** section.
   - The **Drift Warning** section.
   - The **Constraint Verification Protocol**.
   - The **last 3 prompt entries** in Prompt History.
2. If the user's request appears to contradict any item in the Drift Warning, **call it out explicitly in your response** and confirm before changing it.
3. Ground all decisions in what the log already says. Do not re-derive intent from the codebase alone — the log captures *why* things are the way they are.

### Rule 2 — Append a new entry to `PROMPT_LOG.md` *after every change*

Every change ships with a log entry. After implementing the user's request, append a new entry at the bottom of the **Prompt History** section using the template below.

```md
## [YYYY-MM-DD] #NN — Short title

**Prompt (verbatim or summarized):**
> ...

**Intent / Goal:**
- ...

**Decisions made:**
- ...

**Files touched:**
- `path/to/file.tsx` — what changed

**Open questions / Follow-ups:**
- ...
```

The Prompt History is **append-only**. Never edit or delete an existing entry; if a decision is reversed, write a new entry that says so.

### Rule 3 — Refresh the Context Summary every 5+ new entries

The **Context Summary** at the top of `PROMPT_LOG.md` is the fast-path onboarding for the next agent. Keep it accurate.

- Check the `Last refreshed` date.
- If 5+ new entries have been appended since that date, refresh the Context Summary in the same change you're making.
- If fewer than 5, leave it alone.

---

## Coding Conventions

- **Stack:** Expo (React Native + TypeScript). Targets iOS + Android. Mobile-only — no web.
- **Style:** Card-based, generous whitespace, rounded corners, subtle shadows. No web-style dense tables.
- **State of features:** see the Feature Backlog in `PROMPT_LOG.md` — don't re-implement what's already shipped, and don't silently demote shipped features.
- **AI vision:** Gemini 3 Pro via Google AI Studio direct API. Don't switch providers without an explicit prompt.
- **Backend:** Supabase (auth + Postgres + storage). Project `mzsabjegtxmzlfpxmmfm`.
- **Secrets:** Use `EXPO_PUBLIC_*` env vars in `.env.local` (gitignored). Never commit real keys.

---

## For Human Contributors

Same rules apply. Read `PROMPT_LOG.md` first, append an entry after your change, refresh the Context Summary every 5 entries.
