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
- A team admin releases the team's packs from the site with one button. The workflow runs, and the release is live in the
  Manager when it ends.
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
- Receive text reports (see *Contributions and reports*).
- Appointed by site owners only. A team admin cannot appoint one, and `admin` does not imply this
  role: migration 0092 appointed everyone who held `admin`, so nobody lost anything, and a new team
  admin edits original text only once a site owner appoints them.
- Stored as a `language_grant` row whose capability column says `edit`, which the app reads as
  the capability `text`. The stored value stays so a rollback's release can read it.

### Audio team members

Roles inside a team, per language: `regenerate`, `configure`, `ignore`, `record`, `admin`, and a
team-level `edit` that covers the team's text overrides, audio reports and missing audio
(definitions today in `apps/web/src/lib/permissions.ts`).

- A team admin adds members and grants any team role within the team's languages, `admin` included.
  Today only a global admin may grant `configure`, `ignore`, `record` and `admin` (`canGrant`); that
  limit goes, because the team is the boundary now. *(My call.)*
- A person can belong to several teams, and can be a text maintainer and a team member at once.
  Small languages will usually be one person doing both.
- Tables `team` (id, slug, name, languages, created) and `team_member` (team, user, language,
  capability). `team_member` holds every team capability, `edit` included; `language_grant` holds
  only text maintainers. Like `team_language`, `team_member` is read before any team is set, so it
  has no row-level security.

## Text: original and overrides

- The **original text** is the shared `quest_line` / `lore_line` / `book_line` / `boss_line` /
  `entity_name` text. It changes through imports (the pipelines), text maintainers and site owners.
- `line_override` is a team's spoken text for a quest line, in any language, written with the
  explorer's pencil by whoever holds `regenerate` there. Overrides for places, readables and bosses
  wait for *Phase 2*.
- When the original text of a line changes, that team's takes on the line go stale and appear in
  the team's queue, as stale takes do today (`lib/generation/dirty.ts`). The team re-rolls or
  overrides.
- If the team had already overridden the line, the override is flagged **"original changed since
  your override"**, and the team keeps or drops it. Keeping saves the same text again, which marks
  the new original as seen. An override saved before this flag existed stays quiet until saved again.

The pencil writes an override. The one exception is text that branches on the reader's gender on a
plain line, in any language: one file cannot say both, so saving splits the line into `:m` and `:f`,
which changes the original every team shares. That is deliberate for now.

The original otherwise changes through imports and accepted corrections, in English too, so a text
maintainer works in contributions. Editing the original directly, and a translator's way to fill in
a line with no text, come later. Until then a `wrong_text` report that carries no replacement text
can be answered from the site but not fixed.

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
- A report's queue is stored on it (`report.queue`), set when it is filed. Each route checks the
  capability of the report's queue, not only the language: `text` for the text queue, `edit` for
  the audio queue.
- Text maintainers get a **pass to team** action, and the team a **pass to text** action. Neither
  shows when nobody works the queue it would pass to.
- Accepting a report's text as a contribution writes original text, so it needs `text` whichever
  queue the report sits in.
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

A team admin presses **Release** for a section and language, on `/admin/release?lang=xx`. The
site does not build anything: the publisher is the `release-packs.yaml` workflow, which builds the
packs from production's rows and the archive bucket, signs them and writes the Manager channel.
The button starts that workflow and follows it.

A Places, Bosses or Readables run keeps no clips on the runner. `sounds.mjs` writes a pointer where
each clip goes (`scripts/lib/clip-pointer.mjs`), the packaging moves those as it would clips, and
`publish.mjs` lists each pointer as the take it names and copies across only the ones the channel
lacks, checking their hash. Such a build is for the channel alone: its zips hold pointers, so the
workflow only does this with `manager_only`. Quests still pull their masters, because their packs ship
Oggs rather than the takes.

1. The press inserts a `release_run` row (migration 0095) and dispatches the workflow with
   `manager_only` ticked and `dry_run` off, naming the run by the row's id (`release_id`) so the
   site can find it again.
2. Whoever looks at the page settles the row from GitHub (`lib/releases/sync.ts`), at most every
   15 seconds. There is no webhook. Progress is the workflow's current step, shown with a link to
   the run; there is no per-clip count.
3. The run ends `done` or `failed`. A run GitHub has not started 15 minutes after the press is failed
   by the site, so a lost dispatch cannot hold the lock for ever. Nor can an expired token: a run whose
   checks still get errors 9 hours after the press, past any run the workflow allows, is failed too.

**One release at a time, site-wide.** The partial unique index `release_run_one_active` allows one
`dispatching` or `running` row across all teams, and a second press gets a 409 naming the active
run. A team sees only
that another team's release is running, not its step, link or error.

Manager-only mode publishes to the Manager channel alone, with no CurseForge or GitHub upload, and
publishes the folders present in `dist/` (`ONLY_PRESENT=1`), since a build holds one section and
language. Section `bosses` is Manager-only in the workflow: it has no CurseForge project and no
upload target there. English places also builds the bosses pack that its zip carries, so an
English places release publishes `SpokenBossesAudio` too.

In phase 1 every team is the **privileged** team of its languages: its packs keep today's ids and
folders (`SpokenQuestsAudio_deDE`, `SpokenPlacesAudio_frFR`, …), with no team code. Older Managers
see no change.

The workflow encodes and signs; the signing key stays with GitHub Actions, as PLAN.md decided.
Only quests ship Ogg Vorbis
(`scripts/quests/package-audio.sh`, via `oggenc`). Places, readables and bosses ship the take's own
MP3: readables and bosses pack the files as they are, and Places copies them for its full tier and
transcodes only its 64 kbps tier, to MP3 as well.

**Today's release workflow** *(my call)*: `release-packs.yaml` stays the only Manager publisher, and
the site starts it instead of publishing itself, so two publishers never race for one pack's revs.
Manual dispatches still work, including the CurseForge and GitHub upload. A manual dispatch and a
press cannot overwrite each other on the index, because only one run builds at a time and the index
write is conditional. They can cost each other a run: GitHub's `concurrency` group keeps one pending
run and cancels it for a newer one, so a press waiting behind a manual build can end `cancelled`.

## Migration

- One team per group of people, from `language_grant`: people who maintain several languages
  together (for example esES and esMX) form one team covering all of them. English is one team. The
  site owner confirms the grouping before the migration runs.
- Every language the English team holds but `enUS` gets a team of its own (migration 0091,
  slug the lowercased code), with every row of the language, a copy of English's roster, base
  generation settings and dismissal mark, and the site owner as its admin. In `spoken_dev` these
  are deDE, itIT, koKR, ptBR, ruRU, viVN, zhCN and zhTW. A language switched on later gets a new
  team with no members and the same copy of English's roster and settings (`adopt_lang`). There is no shared bucket for unmaintained languages.
- 0091 copied the audio capabilities into `team_member`, in the team that owns the language. 0092
  gave every `edit` holder the team's `edit` as well, appointed every team admin a text maintainer,
  and deleted the audio rows from `language_grant`.
- A handover (`move_team_lang`) moves every row of a language to the new team in one transaction,
  and refuses while a job in the language runs.
- Every existing per-team row moves to the team owning its language. Takes stay live; packs keep
  their names. Non-English edits made before the migration are already in the original text and
  stay there; `line_override` rows move into the English team's layer.
- A handover gives the receiving team a copy of the old team's roster and settings if it has none.
  Only a second team in the same language (phase 2) starts empty: original text, a roster with no
  voices assigned, no settings or lexicon. *(My call.)*

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
- **Text layer.** Per-team overrides generalise `line_override` from quest lines to every `source`.
  The text a team voices, shows and ships is its override where present, else the original, and a
  take's staleness is judged against that.
- **Edit UI** gives text maintainers their own way to edit the original, beside the team's override.

## Left to the builder

- Order of work and how to stage it behind the RLS switch (for example: add `team_id` with one team
  per language first, then turn on policies once every query path goes through the wrapper).
- The exact RLS policy shape, setting name and app role name, and how the cross-team reads that
  must exist (the queue leader claiming jobs, site-owner views, delisting) get through: a separate
  role or narrow security-definer functions.
- How the site generates pack files: port, reuse the Node builders, or call shared code.
- The merged triage page and pass-to actions.
- Slug rules, provided they fit the Manager's id check and WoW folder names.

## Not in this plan

Delisting a team's packs (site-owner moderation; no team needs it while teams are today's
maintainers); per-clip progress; building on the droplet, and encode-at-commit for sections other
than quests, since the workflow encodes; the quests builder port; the signing key on the droplet;
team-owned publishing; clients per team; several English teams; team-owned storage, channels and signing keys; CurseForge
releases for teams; quotas and abuse limits; review before a take or release goes live; terms of
service; publishing community packs (`SpokenCommunity_*`).

Deleting a team, and a team admin's own page for their team. Removing `line_issue` and `line_flag`,
which have no readers. The English override route requiring `regenerate` rather than the team's
`edit`.
