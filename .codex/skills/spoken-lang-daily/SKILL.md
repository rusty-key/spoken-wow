---
name: spoken-lang-daily
description: Run or plan a Spoken language's daily contribution, correction, audio-report, and voice-queue round on spoken.quest. Use for accepting or rejecting localized text, repairing tokenized lines, closing audio reports, and queueing missing or stale production audio. Do not use for direct ElevenLabs previews, voice design, pack releases, or addon linking.
argument-hint: "<lang> [plan]"
---

# Spoken language daily round

This is the Codex entry point for the repository's existing `/spoken-lang-daily`
workflow. It automates review and production queue operations on `spoken.quest`;
it does not replace the site's generation pipeline with direct ElevenLabs calls.

## Read the canonical rules first

Before acting, read these repository files:

- `.claude/skills/spoken-lang-daily/SKILL.md`
- `.claude/skills/spoken-lang-daily/langs/<lang>.md`
- `.claude/skills/spoken-lang-daily/spoken.js`
- `.claude/skills/spoken-lang-daily/config.example.json` when setting up config

The Claude skill is the domain authority for language decisions, contribution
classification, correction handling, audio-report judgment, queue filters, and
the final report. The Codex adapter changes the execution surface and state
location only; do not invent different language rules.

## Modes

- `<lang> plan`: read-only. Inspect the worklist, corrections, reports, queue
  state, and voice backlog, then report what would change. Do not assign, accept,
  reject, rewrite, close reports, or queue audio.
- `<lang>`: perform the full round when the user explicitly asks to run it.
  Follow the canonical clearance rules and leave the review list empty except
  for items the site or an admin alone must resolve.

If the language is missing, ask for it. If its `langs/<lang>.md` file is absent
or still contains `TODO`, run only in `plan` mode and identify the missing
decisions.

## Browser and credentials

Use a browser tab logged in to `https://spoken.quest/<lang>/contributions/quests`.
Never request or read session cookies. If the tab is logged out, stop and ask
the user to log in there. A logged-in 404 means the account lacks maintainer
rights for that language.

Use the browser's documented in-page JavaScript/evaluation surface to load the
whole `spoken.js` helper after setting `window.__spokenCfg` with the language,
configured done models, and `TBC_QUEST_CEILING` from
`apps/web/src/lib/quests/line-client.ts`. Keep calls below the browser surface's
timeout; split large reads by section. Navigation drops `window.__spoken`, so
load the helper again after navigation.

The Text API token is a local file referenced by the language config. Do not
print, expose, or log it. Use it only for the authenticated GET that reads the
current text and version, and for the guarded PATCH that follows, as described by
the canonical skill, with `expectedVersion` and a batch log entry.

Prefer Codex state under `~/.codex/spoken/<lang>/`. If a legacy
`~/.claude/spoken/<lang>/config.json` is the only config, read it without
printing secrets and use it for the current run; do not silently rewrite or
copy credential files.

## Production voice boundary

Production audio must go through the existing `spoken.quest` regeneration queue
with the maintainer's configured voice key. Use `__spoken.plan()`,
`__spoken.queue(...)`, `__spoken.status()`, and `__spoken.voiced(...)` as
described by the canonical skill. Respect `voicingCap` for the whole round:
count all planned non-progress batches together, including step 5c re-voicing,
before queueing any of them. If that combined total would exceed the cap, ask
once before queueing any of those batches; if declined, queue none. Keep the
separate progress-backlog approval rule. Poll until the language's queue is idle or 20 minutes
have elapsed, and never requeue failures automatically.

Do not call ElevenLabs direct speech generation for a production batch. Direct
ElevenLabs tools are appropriate only when the user separately asks for a voice
search, audition, voice design, or standalone preview. They do not commit audio
to Spoken's corpus, take archive, queue, or addon packs.

Do not create or delete provider voices or clones, cancel or discard queue jobs,
change speakers, trigger releases, or rewrite text outside the guarded workflow.
If a browser write is refused, do not bypass the browser or switch to an
unapproved credential path. Report the exact blocked action and continue only
with safe read-only work.

## State and report

Write Codex-owned batch logs and Discord-ready output under
`~/.codex/spoken/<lang>/`. Preserve the canonical report fields: accepted,
repaired, rejected, refused, waiting-for-speaker, corrections, audio reports,
voicing batches, completed/failed counts, credits, release status, and remaining
admin-only work. In `plan` mode use “would” wording and do not write Discord
files.

