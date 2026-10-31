# Independent teams

Design, 2026-10-31. Not yet planned or built.

## Why

Everything on the site is global today: one live take per line, one voice roster, one set of
settings and one lexicon per language, one pack per language on the channel. The only boundary is
`language_grant`. That fits one group voicing each language. It does not fit what comes next: a
second group voicing a language that already has one, with its own voices, its own corrections and
its own pack, and players choosing whose they hear.

Two jobs that are tangled today come apart:

- **Text maintainers** keep a language's original text: they sort through contributions and fix
  the translation every team voices.
- **Audio teams** voice one or more languages: they roll takes, pick voices, tune the lexicon and
  settings, override text where they disagree, and release their own packs.

The first teams are today's language maintainers, and they should not notice the change.

## Phases

**Phase 1, built now, invisible.** Every language, English included, has exactly one team. The
data model, isolation, roles, report routing and the Release button all exist, but every screen,
pack and player experience looks as it does today. Phase 1 is everything in this document except
the section *Phase 2*.

**Phase 2, designed now, built when a second team in one language arrives.** Team-specific pack
ids, clone names, the second index, the player's primary/fallback choice, the explorer's team
picker, and reports that carry the pack's team. See *Phase 2* below.

## Goals

- A team is the boundary for all voicing work: takes, recordings, voices, clones, settings,
  lexicon, text overrides, ignores, flags, issues, queue and activity.
- The data model supports two teams per language from phase 1, even though phase 1 creates only one.
- Isolation is enforced by Postgres row-level security, so a query missing its team filter returns
  nothing instead of another team's rows.
- Text maintainers and audio teams are separate roles; contributions and reports reach the right one.
- A team admin releases the team's packs from the site with one button. The release is live in the
  Manager straight away.
- **Invisible while a language has one team.** Current maintainers, players and packs see no
  change beyond a new Release button: same pages, same edit behaviour, same pack folders, no
  re-download, no lost take.

## Non-goals

- **Clients per team.** Every pack keeps shipping one `.toc` for Forever, Era and TBC. What "a team
  covers some clients" should mean is postponed.
- **Teams' own infrastructure.** All takes and packs stay on our R2 buckets and our one channel,
  signed with our key. Self-hosted channels, team signing keys, a publish CLI, GitHub Action
  templates and a Manager publish button are later work.
- **CurseForge and GitHub releases for teams.** `release-packs.yaml` keeps shipping today's packs
  there. Team releases reach players through the Manager only.
- **Provider accounts per team.** Payment stays as it is: every member brings their own ElevenLabs
  or fish key, and a queued job runs on its owner's key.
- **Several English teams.** English is one team in phase 1.
- Quotas, abuse limits, review before a take goes live, terms of service. Still open, as in
  [`PLAN.md`](PLAN.md).

## Anti-goals

- A "Spoken core" team with special powers. Every team is equal. One team inherits English; that is
  data, not code.
- A forgotten `where` leaking one team's takes, voices or lexicon into another's pages, queue or
  pack. Equally: a forgotten wrapper leaving a page empty for the team that owns it.
- Anything a single-team language's maintainers have to learn, click through or rename.
- A pack promoting itself over another team's (phase 2). Today any quests pack can raise its own
  `X-*-DataModule-Priority`; once two teams share a language, only the player's choice decides.

## Roles

### Site owners

Today's global `admin`. Above all teams: create teams and set their languages and first admin,
appoint text maintainers, act inside any team with full rights without being a member *(my call)*,
and delist a team's packs.

### Text maintainers

A per-language role that sits outside teams. Today's `language_grant` `edit` already covers almost
exactly this, so it stays a site-level grant.

- Edit the **original text** of their language: quest, place, readable and boss text, and NPC and
  place names (`entity_name`).
- Triage contributions and corrections from players (`contribution*`, `lib/contributions/*`).
- Receive text reports (see *Reports*).
- Appointed by site owners. *(My call.)*

### Audio team members

Roles inside a team, per language: `regenerate`, `configure`, `ignore`, `record`, `admin`, and a
team-level `edit` that covers the team's text overrides, audio reports and missing audio
(definitions today in `apps/web/src/lib/permissions.ts`).

- A team admin adds members and grants any role within the team's languages, `admin` included.
  Today only a global admin may grant `configure`, `ignore`, `record` and `admin` (`canGrant`); that
  limit goes, because the team is the boundary now. *(My call.)*
- A person can belong to several teams, and can be a text maintainer and a team member at once.
  Small languages will usually be one person doing both.
- Tables `team` (id, slug, name, languages, created) and `team_member` (team, user, role grants).
  `language_grant` keeps only the text-maintainer `edit`; its other capabilities move to
  `team_member`.

## Text: original and overrides

- The **original text** is the shared `quest_line` / `lore_line` / `book_line` / `boss_line` /
  `entity_name` text. It changes through imports (the pipelines), text maintainers and site owners.
- Each team has a **text layer** on top: per-team overrides, generalising `line_override` to
  `(team, source, lang, line)`. The text a team voices, shows and ships is its override where
  present, else the original. A take's staleness is judged against that.
- When the original text of a line changes, that team's takes on the line go stale and appear in
  the team's queue, as stale takes do today (`lib/generation/dirty.ts`). The team re-rolls or
  overrides.
- If the team had already overridden the line, the override is flagged **"original changed since
  your override"**, and the team keeps or drops it.

**Invisible while one team voices a language.** Editing a line does exactly what it does today in
that language:

- Outside English, an edit by someone who is a text maintainer changes the original text, as now.
- In English, an edit becomes the team's override, as `line_override` does now.

The explicit "override for my team" action, and the choice between editing the original and
overriding, only appear in a language with two teams.

## Contributions and reports

Contributions arrive from players with no team. They go to the language's text maintainers.

Reports are routed by their existing category (`report_category_check`, migration 0021):

| Category | Goes to |
|---|---|
| `wrong_text` | the language's text maintainers |
| `pronunciation`, `wrong_voice`, `audio_quality`, `missing` | the audio team voicing that language |
| `other` | text maintainers, who can pass it to the team |

- A `wrong_text` report on a line the team has overridden goes to the team, since the text the
  player heard was the team's.
- Text maintainers get a **pass to team** action, and the team a **pass to text** action.
- **Invisible while the two groups are the same people.** If a language's text maintainers and its
  team members are the same people, the two queues show as one page, today's triage page. Routing
  happens underneath and is only visible when the groups differ.
- Reports that predate teams go to the language's team. *(My call.)*

## What is per team and what is shared

Per team (gains `team_id`, unique keys re-keyed to include it):

- `take` and its live pointer `take_current_idx`, unique on `(team, source, lang, file)` where
  current; `recording`; `take_ack`.
- `voice`, `voice_assignment`, `voice_clone`, `voice_sample`, `fish_reference`.
- `generation_setting_locale`, `pronunciation_lexicon_locale`, `lexicon_change`.
- The text layer, `line_ignore`, `line_flag`, `line_issue` and `line_issue_line`, audio reports.
- `regeneration_batch`, `regeneration_job`, `regeneration_pause`, `queue_dismissal`, `activity`.

The single-row English tables `generation_setting` and `pronunciation_lexicon` fold into the
`_locale` tables keyed `(team, lang)`, so English stops being a special case. The English
dictionary id pinned by `ELEVENLABS_DICTIONARY_ID` moves into the English team's row; the variable
stays readable as that row's seed because `../wow-lore` pins the same dictionary.

Shared (no team): the original text and game data (`quest_line`, `lore_line`, `book_line`,
`boss_line`, `entity_name`, `broadcast_text`, the gossip tables), NPCs and races (`npc*`, `race`,
`gender`, `flavor`), `contribution*`, text reports, `missing_audio_hit`, `quest_corpus_meta`, users
and auth, per-user keys and preferences (`elevenlabs_key`, `fish_key`, `generation_preference*`),
and `take_encoding`. `take_encoding` holds the Ogg encoding of a take's audio keyed by its sha256,
so identical audio has one encoding whoever made it, and a row can only be found by already knowing
the hash.

## Who sees what

Live takes are public across teams, as packs are, and members can listen to other teams' live
takes. Everything else is private to the team: take history, recordings not yet live, voices and
clones, settings, lexicon, overrides in progress, queue, activity, audio reports and issues. Writes
are always scoped to the team being worked in.

In phase 1 there is one team per language, so the explorer shows what it shows today.

## Isolation with row-level security

- A new non-owner database role for the app. Today the app connects as `spoken`, which owns every
  table, and owners bypass RLS. Per-team tables get `ENABLE` and `FORCE ROW LEVEL SECURITY` and a
  policy matching `team_id` against a session setting (for example `spoken.team`). An unset setting
  matches nothing.
- Every query on a per-team table goes through a wrapper that opens a transaction and sets the team
  with `set_config(..., true)` (transaction-local). Requests do not run in a transaction today, and
  a pooled connection must never carry one team's setting into another's request. `lib/db.ts`
  (`db()`, `query()`, `inTransaction`) is where this lives.
- The team for a request: the team the user is working in. In phase 1 that is the team voicing the
  page's language, so no switcher is needed; a header switcher appears only for someone in two teams
  that share a language.
- The queue worker sets the team from the job it runs. Jobs, batches and pauses carry the team.
- The public cross-team read of live takes and their text goes through a narrow path (a view or
  security-definer function returning only live rows), not by loosening the per-team policies.
- Migrations and the pipelines keep the owner role. Pipelines mostly touch shared data, with these
  exceptions *(my calls)*:
  - `pipelines/quests/tts_cli/corpus_db.py` seeds `voice` / `voice_assignment` rows when a new
    race, gender or flavor appears. It seeds them for every team.
  - `pipelines/readables/tools/lib/absorb.mjs` rewrites a minted page id across `take`, `report`,
    `recording` and `regeneration_job`. It does so for every team, as it must.
  - `pipelines/places/tools/voice/store.mjs` and `pipelines/places/tools/bosses/store.mjs` read
    `take`. They become team-aware if the site's release reuses them.
- The risk to test for before release: a query path that misses the wrapper shows its owner an
  empty page. Every page and route must be exercised as the app role, not the owner.

## Voices and clones

- Each team has its own roster and assignments.
- Clone names stay as today: `slot` for English, `slot@deDE` otherwise (`lib/voices/clone-name.ts`).
  The generator finds a clone by that name in the caller's own provider account. A clash would need
  one person in two teams voicing the same language, which cannot happen in phase 1.

## Releases

A team admin presses **Release** for a section and language. The job runs in the existing queue
worker, with per-item progress shown in the UI (`412/2448 clips`) and a summary at the end:

1. Reads the team's live takes.
2. Copies each take's Ogg from the archive bucket to the packs bucket's `blobs/<sha256>`, server-side
   inside R2, skipping blobs already there.
3. Generates the pack's text files (`.toc`, Lua data tables, module file), hashes and uploads them.
4. Writes the signed manifest `packs/<packId>/<rev>.json`.
5. Updates `index.json` with the conditional write `scripts/manager/publish.mjs` already uses, so
   concurrent releases cannot overwrite each other.

There is no approval step. A site owner can delist a team, which removes its entries from the
index; that is the only moderation in this version.

In phase 1 every team is the **privileged** team of its languages: its packs keep today's ids and
folders (`SpokenQuestsAudio_deDE`, `SpokenPlacesAudio_frFR`, …), with no team code. Older Managers
see no change.

What this needs:

- The pack builder ported to the site. Quests packs are built in Python today
  (`pipelines/quests/tts_cli/build.py`, `scripts/quests/package-audio.sh`); the site must produce
  the same files from the database. Places and readables have Node builders that may be reused.
- Encode at commit for every section. Only quests takes get a `take_encoding` today
  (`apps/web/src/lib/takes/encode.ts`); places, readables and bosses need one too, so the release
  never transcodes on the droplet.
- The publisher (`scripts/manager/publish.mjs`, `sign.mjs`, `manifest.mjs`) moved into a library
  the app can call, and `SPOKEN_PACKS_SIGNING_KEY` on the droplet. This reverses the PLAN.md
  decision that only GitHub Actions holds the key.

**Today's release workflow** *(my call)*: `release-packs.yaml` stops publishing to the Manager
channel; the site's Release is the only Manager publisher, so two publishers never race for one
pack's revs. The workflow keeps building CurseForge and GitHub packs, from each language's team's
takes, filtered by team since it reads production as the owner role and RLS does not filter it.

## Migration

- One team per group of people, from `language_grant`: people who maintain several languages
  together (for example esES and esMX) form one team covering all of them. English is one team. The
  site owner confirms the grouping before the migration runs.
- Languages with live takes but no grant holders (in `spoken_dev`: deDE, itIT, koKR, ptBR, ruRU,
  zhCN, zhTW) go to the English team until handed over.
- Everyone holding `edit` in a language becomes both its text maintainer and a member of its team.
  Other capabilities move to `team_member` unchanged.
- Every existing per-team row moves to the team owning its language. Takes stay live; packs keep
  their names. Non-English edits made before the migration are already in the original text and
  stay there; `line_override` rows move into the English team's layer.
- A team created later in an already-voiced language starts empty: original text, a roster with no
  voices assigned, no settings or lexicon. Copying another team's setup is later work. *(My call.)*

## Phase 2: a second team in one language

Designed now so phase 1 does not paint it into a corner; built when the first such team arrives.

- **Pack ids.** The privileged team keeps the bare ids. Another team's packs carry its slug, for
  example `SpokenQuestsAudio_deDE_<team>`, and their `.toc` carries `X-Spoken-Team`. The index entry
  carries the team. Pack folder names are not on the frozen list in [`AGENTS.md`](../../AGENTS.md);
  line ids are, and they do not change.
- **Manager.** The id check (`manager/src/main/packs-remote.ts:50`, mirrored at
  `scripts/manager/publish.mjs:13`) accepts the suffix, and `SPOKEN_FOLDERS` / `products.ts` stop
  being the only list of folders the Manager may install. Today the Manager rejects the whole index
  if one entry fails that check, so team-aware Managers read a versioned index (for example
  `index-v2.json`) that carries every team's packs, while `index.json` keeps only the ids older
  Managers accept. Every release writes both.
- **Clone names** gain the team slug for teams other than the privileged one.
- **Player side.**
  - Every installed pack registers with Spoken along with its team and language; Settings lists them.
  - Per language and per section (quests, places, readables, bosses), the player marks one pack
    primary and one fallback. A line plays from the primary; if the primary lacks it, from the
    fallback; then today's language fallback (`addons/Spoken_Quests/Language.lua:168-176`) applies.
  - With no choice made, the pack with the most lines is primary. The setting only appears when two
    packs for one language are installed.
  - This replaces folder-name order and self-declared priority in `DataModules.lua` (`SortModules`),
    and the "one pack per language" assumptions in `Spoken_Places/Audio.lua`,
    `Spoken_Readables/Audio.lua` and `Spoken_Bosses/Audio.lua`. The Places picker (`/spp audio`) is
    the existing pattern to generalise.
- **Explorer** gets a team picker per language.
- **Reports** from the addon carry the team of the pack that played the line, so audio reports reach
  that team. A report without a team (older addons) goes to every team voicing that language.
- **Edit UI** shows the choice between editing the original (text maintainers) and overriding for
  the team.

## Left to the builder

- Order of work and how to stage it behind the RLS switch (for example: add `team_id` with one team
  per language first, then turn on policies once every query path goes through the wrapper).
- The exact RLS policy shape, setting name and app role name, and how the cross-team reads that
  must exist (the queue leader claiming jobs, site-owner views, delisting) get through: a separate
  role or narrow security-definer functions.
- How the site generates pack files: port, reuse the Node builders, or call shared code.
- Release button placement and progress display; the merged triage page and pass-to actions.
- Slug rules, provided they fit the Manager's id check and WoW folder names.

## Not in this plan

Clients per team; several English teams; team-owned storage, channels and signing keys; CurseForge
releases for teams; quotas and abuse limits; review before a take or release goes live; terms of
service; publishing community packs (`SpokenCommunity_*`).

A separate bucket for languages no team owns. In phase 1 every language the site knows is parked
on the English team when a server process starts its queue and when a language is switched on (`adoptEveryLang`,
`apps/web/src/lib/teams/store.ts`), so a report, activity or queue action in it always has a team
to land on. That is a stopgap: eventually a language no team owns goes to a separate bucket, not
English.
