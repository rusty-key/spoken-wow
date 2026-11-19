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

**Phase 1, built now, invisible.** Every language, English included, has one team, equal to any it
gains later. The data model, isolation, roles, report routing and the Release button all exist, but
every screen, pack and player experience looks as it does today. Phase 1 is everything in this document except
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
- **Teams' own infrastructure, beyond storage.** A team may keep its takes in its own bucket
  ([`STORAGE.md`](STORAGE.md)), but its packs stay on our one channel, signed with our key.
  Self-hosted channels, team signing keys, a publish CLI, GitHub Action templates and a Manager
  publish button are later work.
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

### A language's teams

A language's teams are equal: none is its main team. What used to make one team "privileged" now
only names its packs. `team_language."packName"` (migration 0123) is `plain` (`<Pack>_<lang>`) or
`slug` (`<Pack>_<lang>_<slug>`), set when the team joins the language and never changed, so no pack a
player has is renamed. Every team privileged before 0123 kept `plain`; every other kept `slug`. A
team joining later gets `plain` when its slug is the language code lowercased and no team of the
language has `plain`, else `slug`. One team per language at most has `plain`.

- A language gets a team when a site owner adds it or an approved request founds one
  (`found_lang_team`), not for being known or switched on. English alone is still given one at
  boot. A language may have no team.
- An invite names the team it joins. One stored before 0123 with no team, which meant the
  privileged team, had the plain team written in.
- A rejected contribution's lines are ignored for the whole language: a `line_ignore` row with the
  language and no team, which every team of the language honours and anyone who may ignore there
  may lift. A team's own ignore stays that team's.
- `privileged` and `team_of_lang()` remain for older releases, and follow `packName`: the
  privileged team is the one with plain packs. No script reads them.
- The site picks no team by rank. A request works as the person's team in the language; in a
  language with one team, as that team, whoever asks. In a language with several, somebody who works
  in none of them has no team there: their writes refuse, and the explorer shows them a team
  read-only (*Who sees what*).
- A grant or an invite lands in the granter's team; a site owner's in the person's own team, else
  the team the site owner acts in.
- Where a language lets its teams appoint text maintainers (`textByTeam`), an admin of any of its
  teams may. *(My call.)*

### Site owners

Today's global `admin`. Above all teams: create teams and set their languages and first admin,
appoint text maintainers, act inside any team with full rights without being a member *(my call)*,
and delist a team's packs. A site owner acts inside a team by picking it in the explorer's team
picker; the choice is kept per language in a cookie and lasts until they pick again. While it holds,
every page of the language says "Working as {team}". With no pick, a site owner acts in their own
team in the language, else the first the picker lists.

### Text maintainers

A per-language role that sits outside teams. Today's `language_grant` `edit` already covers almost
exactly this, so it stays a site-level grant.

- Edit the **original text** of their language: quest, place, readable and boss text, and NPC and
  place names (`entity_name`).
- Triage contributions and corrections from players (`contribution*`, `lib/contributions/*`).
- Receive text reports (see *Contributions and reports*).
- Independent of team membership: a maintainer sees the text queue whatever team they work in, and
  text reports and contributions follow the `text` grant.
- A maintainer's write-enabled API token writes the original text by default, whatever team they work in, and
  their team's overrides with `"layer": "override"` when they also hold `regenerate`.
- Appointed by site owners only. A team admin cannot appoint one, and `admin` does not imply this
  role: migration 0092 appointed everyone who held `admin`, so nobody lost anything, and a new team
  admin edits original text only once a site owner appoints them.
- Stored as a `language_grant` row whose capability column says `edit`, which the app reads as
  the capability `text`. The stored value stays so a rollback's release can read it.

### Audio team members

Roles inside a team, per language: `regenerate`, `configure`, `ignore`, `record`, `admin`, and a
team-level `edit` that covers the team's audio reports and missing audio
(definitions today in `apps/web/src/lib/permissions.ts`). Overrides are written under `regenerate`
in every team, and the original text only under `text`.

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
  explorer's pencil by whoever holds `regenerate` there.
- `text_override` is a team's spoken text for a place's prose, a readable page or a boss story,
  kept per line id and written by whoever holds `regenerate` in the language, from the override
  button in the places, bosses and readables explorers. Only what the team's audio says changes:
  the text shown on the site and in game stays the original, and so does every name. A readable's
  spoken title keeps the original name too. *(User.)* A line with no text in the language cannot
  be overridden; its text is written first, with the explorer's pencil by whoever holds `text`
  there, or through contributions in the sections that take them.
- A take is stale when the text the team speaks for the line changes: its override where it has
  one, else the original. So a change to the original makes the takes of a line the team has not
  overridden stale, and they appear in the team's queue (`lib/generation/dirty.ts`). The team
  re-rolls or overrides.
- If the team had already overridden the line, its takes still speak the override and stay
  current, and the override is flagged **"original changed since your override"**: the team keeps
  or drops it, and dropping it makes the takes stale. Keeping saves the same text again, which marks
  the new original as seen. An override saved before this flag existed stays quiet until saved again.

In the quests explorer the pencil writes an override. In the places, readables and bosses explorers
the pencil writes the original and the speech button writes the override. The one exception in
quests is text that branches on the reader's gender on a plain line, in any language: one file
cannot say both, so saving splits the line into `:m` and `:f`, which changes the original every
team shares. That is deliberate for now, so a split needs `text` in
the language beside `regenerate`, whatever team its holder works in.

The original otherwise changes through imports and accepted corrections, in English too. For quest
lines a text maintainer works in contributions, so a `wrong_text` report on one that carries no
replacement text can be answered from the site but not fixed. In the places, readables and bosses
explorers the pencil edits the original directly, a line with no text yet included.

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
- A report that names no team (an older addon, the plain pack, the site's forms) goes to the
  reporter's team, else the team with plain packs. In a language with several teams and none with
  plain packs, an audio report is filed once per team, and a text report once.
- An act is logged under the team its actor works in, unless it names its own team; by somebody in
  no team of the language, under none.

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

A team's override is public on a line with a live take that speaks it, so the text shown with
another team's takes is what they say. Otherwise it stays private. *(User.)*

A language with one team shows no picker, so the explorer shows what it shows today. With several,
every team is in the picker, none marked. Without `?team=` it plays the team the visitor works in,
else the one with plain packs, else the first by name; a visitor in none of them hears that team
read-only.

## Isolation with row-level security

- A new non-owner database role for the app. Today the app connects as `spoken`, which owns every
  table, and owners bypass RLS. Per-team tables get `ENABLE` and `FORCE ROW LEVEL SECURITY` and a
  policy matching `team_id` against a session setting (for example `spoken.team`). An unset setting
  matches nothing.
- Every query on a per-team table goes through a wrapper that opens a transaction and sets the team
  with `set_config(..., true)` (transaction-local). Requests do not run in a transaction today, and
  a pooled connection must never carry one team's setting into another's request. `lib/db.ts`
  (`db()`, `query()`, `inTransaction`) is where this lives.
- The team for a request: the person's team in the language, else, where the language has one
  team, that team. One person works in one team per language, so members need no switcher. A site
  owner's pick in the team picker overrides both (see *Site owners*).
- The queue worker sets the team from the job it runs. Jobs, batches and pauses carry the team.
- The public cross-team read of live takes and their text goes through two security-definer
  functions, not by loosening the per-team policies. Both answer nothing for a team that does not
  voice the language, and only the app role may call them.
  - `team_live_takes` returns a team's current takes in a language and source: line id, file,
    version, spoken hash, characters, duration, bytes and date, plus the archive location the
    server needs to serve the audio, which never reaches a browser. No credits, cost, model, voice,
    provider, author, settings or take count, which would reveal the team's history.
  - `team_live_overrides` returns a team's override text, keyed by line, only on lines with a
    live take that speaks it, judged by spoken hash; on a quest line, every voice's take must.
    No author, date or original hash. The same rule holds for a visitor who does not work in the
    language looking at the team they are given by default: the search shows an override only
    once a live take speaks it, and never who wrote it.
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
  one person in two teams voicing the same language, which cannot happen while one person works in
  one team per language.

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
`dispatching` or `running` row across all teams. On the droplet a press while another runs is
**queued** (migration 0121): it waits as `queued`, with the bump it asked for, and whenever a run
settles the oldest queued one starts (`lib/releases/launch.ts` `startNext`). On the droplet a tick
in pm2's first worker (`lib/releases/tick.ts`, started at boot by `instrumentation-node.ts`, apart from
the regeneration queue) settles a finished job and starts the next every 15 seconds, so the queue moves
with no release page open; a reload waits for a tick still starting a run. A queued run whose job
cannot start ends `failed`, and the next one starts, so the queue never stalls; so does one still
`dispatching` two minutes after it started with no job directory, which a restart between claiming
it and spawning its job leaves. Whoever pressed it, or
a site owner, can cancel a queued run (`DELETE /api/releases/<id>`). A run dispatched to GitHub
Actions still gets a 409 while another is active, since the workflow's own `concurrency` group queues
there. Promotions and delistings (below) take the same queue. A team sees only that another team's
release is running, not its step, link or error.

Manager-only mode publishes to the Manager channel alone, with no CurseForge or GitHub upload, and
publishes the folders present in `dist/` (`ONLY_PRESENT=1`), since a build holds one section and
language. Section `bosses` is Manager-only in the workflow: it has no CurseForge project and no
upload target there. English places also builds the bosses pack that its zip carries, so an
English places release publishes `SpokenBossesAudio` too.

A team's pack name in each language (`team_language.packName`) decides its folders. Every team that
had the language before teams were equal has `plain` packs, with today's ids and folders
(`SpokenQuestsAudioHorde_deDE`, `SpokenPlacesAudio_frFR`, …) and no team code. Older Managers see no
change.

Every section publishes from the droplet, whose copy of the signing key sits in
`shared/release.env`, as PLAN.md decided.
Only quests ship Ogg Vorbis
(`scripts/quests/package-audio.sh`, via `oggenc`). Places, readables and bosses ship the take's own
MP3: readables and bosses pack the files as they are, and Places copies them for its full tier and
transcodes only its 64 kbps tier, to MP3 as well.

### Team releases

Every team admin can press Release; a press builds the packs of the team it was made in, read from
that team's live takes alone. The run carries the team (`release_run.teamId`), the droplet job
passes its slug to `release.mjs --team`, and every builder query takes the release's team
(`pipelines/lib/release-team.mjs`, `SPOKEN_RELEASE_TEAM`). A build outside a release reads the team
with the language's `plain` packs, and a language with none reads no team. `release.mjs` without
`--team` (`make manager-release TEAM=`) builds for the language's only team and refuses a language
with several. The scripts run by hand that read one team's rows (`acted.mjs`, `fetch-encodings.mjs`,
`push-sources.sh`) take `--team` or `TEAM=` and default to the team with `plain` packs.

- **Official.** `team.official` (migration 0120) is set on every team made before it, on a team a
  site owner creates or founds with a new language, and on the team of a language a site owner adds.
  An approved request makes a team that is not official. Only a site owner changes it, on
  `/admin/teams`. Official decides whether a release waits for review and whether the Manager names
  the team on its packs; it does not change pack ids.
- **Pack ids.** A team with `plain` packs in the language builds the plain ids
  (`SpokenPlacesAudio_jaJP`), official or not. A team with `slug` packs carries its slug after the
  language (`SpokenPlacesAudio_deDE_stimmen`, `scripts/lib/packs.mjs` `teamFolder`). A team's slug never
  changes: `PATCH /api/teams/[id]` takes no slug, since a new one would orphan every installed pack.
- **Page packs stay as they were.** A team with `plain` packs whose language has a store page with
  `manager: true` for the section builds that page's pack, with the same folders, title, version,
  icon and `.toc` (`scripts/manager/release.golden.json` pins them).
- **Derived packs** are every other release (`scripts/manager/release-pack.mjs`): English's Manager
  folders for the section, each with the suffix. Their first version is `1.0.0`, later ones bump from
  the channel. The title names the language and, with a slug, the team (`Spoken German Audio: Places
  (Stimmen)`). The `.toc` carries `X-Spoken-Team` and `X-Spoken-TeamName` for a suffixed pack, and
  `X-Spoken-LanguageName` and `X-Spoken-LanguageNative` for a language Spoken does not build in. A
  language with no badged icon wears English's mark; a page pack missing its badge is still an error.
  The language comes from the `language` table, not `pipelines/lib/locales.mjs`.
- **Two indexes.** `index-v2.json` is the channel's record: every pack, each with `lang`, `section`,
  `pack` (the quests side, else null) and `team` (`{ slug, name, official }`, null for a page pack),
  and a `languages` map (`code`, `name`, `native`) for the languages it lists. `index.json` is written
  from it in the same publish with only the ids older Managers accept, in the shape they read, so
  they never see a team's pack. The first publish seeds `index-v2.json` from `index.json`. Spoken's
  own zips are `publish-addon.mjs`'s, which writes `index.json`; each pack publish copies them to
  both. A publish that fails between the two writes leaves `index.json` behind, and the next one
  catches it up.
- **Review.** An official team's release publishes as before and ends `done`. A release of a team
  that is not official **stages**, decided at the press from `team.official` and kept on the row
  (`stage`): `release.mjs --stage` uploads the blobs and signs each pack's manifest
  (`packs/<folder>/<rev>.json`) but writes neither index, and leaves what it staged in the run's
  directory (`staged.json`), with the takes its clip pointers were made from (`takes`, by file: version
  and hash, which `scripts/audio/sounds.mjs` records). The site stores that on the row (`staged`, and
  `takes` in a column of its own) and settles it `awaiting_review`, and emails the site owners. They
  review it on `/admin/team-releases`: team, language, section, version, who pressed it, and the lines
  whose take in the pack is not the one players have, compared with the takes of the team's release
  players have (every line when they have none). A version or a listed release built before builds
  recorded their takes is counted as the team's own release page counted it when its build started
  (the takes live then). Each line plays the version built (`/api/releases/<id>/take`, a site owner's
  alone: the take routes serve another team only its live takes), and says so where the team recut it
  since. A link opens the explorer on `?team=<slug>`. **Approve** makes
  the staged run `approved` and queues a `promote` run (`scripts/manager/cli.mjs promote`), which
  writes the staged entries into both indexes; its success makes the staged run `done`, so `done`
  keeps meaning "players have it", and the team's pending counts drop only then. An `approved`
  version can be neither rejected nor superseded. Promotion refuses a pack whose live rev moved since it was staged
  (each entry records the rev it was staged over), and one whose manifest is missing. A failed or
  cancelled promotion puts the version back to `awaiting_review`, with the reason, or `superseded`
  when a newer version of the pack came to wait meanwhile. **Reject** needs a reason, settles the run
  `rejected`, and the team sees "Not approved: <reason>" and gets it by email. Staged blobs and
  manifests are public by address and listed nowhere; nothing deletes them. A team admin cannot
  approve their own version: the review routes are a site owner's.
- **One waiting version per pack.** A team's new staged version of a section and language marks the
  older waiting one `superseded` once it reaches `awaiting_review`, not before, so a failed build
  leaves the waiting one in place. Every version waits, the first and every update.
- **Delisting.** A site owner can take a team's pack (one section, language and team) off the
  channel from the same page: a `delist` run (`scripts/manager/cli.mjs delist`) resolves the team and every folder the
  team's pack can have, and removes them from both indexes, and its files stay. The team's release page says
  "Delisted by a site owner."; its next approved release lists the pack again. An official team's
  packs are not delisted here.
- **Opened per site.** A press by a team that is not official, or whose packs carry its slug, gets
  409 unless the site sets `SPOKEN_TEAM_RELEASES=1` and releases on the droplet (`deploy/web/README.md`,
  *Team releases*); `release.mjs` refuses a derived pack without it. Staging sets it. Production sets it
  only once a Manager that reads `index-v2.json` and a Spoken that orders a language's voices have
  shipped, since no player could install such a pack before.

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
  are deDE, itIT, koKR, ptBR, ruRU, viVN, zhCN and zhTW. A language a site owner adds later gets a
  new team with no members and the same copy of English's roster and settings (`found_lang_team`).
  There is no shared bucket for unmaintained languages.
- 0091 copied the audio capabilities into `team_member`, in the team that owns the language. 0092
  gave every `edit` holder the team's `edit` as well, appointed every team admin a text maintainer,
  and deleted the audio rows from `language_grant`.
- A handover (`move_team_lang`) moved every row of a language to the new team in one transaction,
  and refused while a job in the language ran. The site no longer hands a language over: a team
  joins a language beside its others, and leaves it by being removed from it or deleted.
- Every existing per-team row moves to the team owning its language. Takes stay live; packs keep
  their names. Non-English edits made before the migration are already in the original text and
  stay there; `line_override` rows move into the English team's layer.
- A team joining a language starts as any new team does: it inherits the original text and never
  another team's takes or text overrides, and starts from English's roster and settings as a new
  language does, or, where the language has a team, from a copy of the first one's settings, as the
  site owner chooses at approval. *(User.)*

## Phase 2: several teams in one language

Designed now so phase 1 does not paint it into a corner; built when the first such team arrives.

- **Pack ids.** The team with plain packs keeps the bare ids. Another team's packs carry its slug, for
  example `SpokenQuestsAudio_deDE_<team>`, and their `.toc` carries `X-Spoken-Team`. The index entry
  carries the team. Pack folder names are not on the frozen list in [`AGENTS.md`](../../AGENTS.md);
  line ids are, and they do not change.
- **Manager.** The id check (`manager/src/main/packs-remote.ts:50`, mirrored at
  `scripts/manager/publish.mjs:13`) accepts the suffix, and `SPOKEN_FOLDERS` / `products.ts` stop
  being the only list of folders the Manager may install. Today the Manager rejects the whole index
  if one entry fails that check, so team-aware Managers read a versioned index (for example
  `index-v2.json`) that carries every team's packs, while `index.json` keeps only the ids older
  Managers accept. Every release writes both.
- **Clone names** keep their shape while one person works in one team per language; they gain the
  team slug only if that rule is ever lifted.
- **Player side.** Built, with a change to this design: no primary
  and fallback per language, but one ordered list of voices for every module.
  - Every installed pack registers with Spoken along with its language and, from `X-Spoken-Team`
    and `X-Spoken-TeamName`, its team (`addons/Spoken/Languages.lua`). A voice is a language
    (`deDE`, the plain pack) or a language and a team (`deDE_stimmen`).
  - The player orders voices on Spoken's page (`Language.Voices`, `Spoken:GetVoiceOrder`). A line
    plays from the first voice whose pack has it, and past the last stays silent. With no list set,
    each module keeps the voice language and fallback it had.
  - Voice order replaces self-declared priority between packs of different teams in
    `DataModules.lua`, and the "one pack per language" assumptions in `Spoken_Places/Audio.lua`,
    `Spoken_Readables/Audio.lua` and `Spoken_Bosses/Audio.lua`. Packs of one voice keep their old
    order (priority, `/spp audio`'s choice, bitrate).
- **Explorer.** Built: a team picker per language, which plays the picked team's live takes,
  read-only when it is not the visitor's own team.
- **Reports** from the addon carry the team of the pack that played the line (`packTeam`, the team's
  slug), and the site files them with that team when it voices the report's language
  (`apps/web/src/lib/reports/store.ts`). Built. A report without a team came from a plain pack,
  since an older addon can play no other, and is filed with the team with plain packs (*Contributions
  and reports*).
- **Text layer.** Per-team overrides generalise `line_override` from quest lines to every `source`.
  The text a team voices is its override where present, else the original, and a take's staleness
  is judged against that. Built for the site as `text_override`: places, readables and bosses are
  overridden from their explorers, and the text API writes them with `"layer": "override"`.
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
maintainers); per-clip progress; encode-at-commit for sections other than quests; the quests
builder port;
team-owned publishing; clients per team; several English teams; team-owned storage, channels and signing keys; CurseForge
releases for teams; quotas and abuse limits; review before a take or release goes live; terms of
service; publishing community packs (`SpokenCommunity_*`).

A team admin's own page for their team (a site admin can delete an empty team: `SELF-SERVE-TEAMS.md`). Removing `line_issue` and `line_flag`,
which have no readers. The English override route requiring `regenerate` rather than the team's
`edit`.
