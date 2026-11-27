# Self-serve teams

Design, 2026-11-12. Requests and approval are built (plan 2) for new and unmaintained languages, the second team for a maintained one (plan 5a), on the site the text layer for places, readables and bosses (plan 5b), the text API's override layer (plan 5b2), and the Explorer's team picker (plan 5c). Builds on [`TEAMS.md`](TEAMS.md) phase 1.

## Why

Today a site owner creates every team by hand. Languages already load from the database (see
*The big change*), but only a site admin can add one. Someone who wants to voice a language
Spoken does not have, say Japanese, has to ask. They should be able to register, ask for a team
with a new language, and once a site owner approves it, run that language on their own: bring
people in, translate through the site or a script, and voice it on their own provider key.

The worked example throughout is a translator who wants to start Japanese (`jaJP`).

## What the translator can do

1. **Register** on spoken.quest (email and password, as today).
2. **Request a team** from a page on the site: a language and a team name. The language is
   either one the site already has, or a new code with its English and native names. This
   creates a pending request. They become the team's admin when it is approved.
3. **Wait.** Until a site owner approves, the team is locked: they can see the request's status
   and withdraw it, nothing else. No text, no voices, no generation, no tokens.
4. **After approval**, everything a language admin can do today, in their language, plus:
   - **Invite** people by email, whether or not they have registered. An invite names the
     capabilities it grants and is accepted by signing in or registering from its link.
   - **Grant every capability their team holds in the language** to members of their team. That
     includes `text` only when the team got `text` on approval (see *What approval does*).
   - **Create API tokens** for their language.
5. **Through the API**, with a token:
   - **Read English reference text**: `GET /api/v1/<section>/reference`, English lines only, with
     the same filters, cursors and limits as the existing list.
   - **Read and write their language's text**: the existing `GET`/`PATCH /api/v1/<section>`.
   - **Generate takes**: a new endpoint that queues regeneration in the token's language, on the
     token owner's own ElevenLabs or fish key, the same jobs the site's Regenerate button queues.

Takes never leave the site through the API. Nothing downloads audio, English or otherwise.

## What the site owner does

- Sees pending requests on the admin teams page and approves or rejects each one.
- **Approve** does one of two things, by the state of the language (below), and makes the
  requester the team's admin.
- **Reject** closes the request; the requester can see it was rejected.
- **Appoints text maintainers** for languages that already have them, as today.
- **Creates a team for a new language directly** from the New team form on `/admin/teams`: a
  "New language…" choice takes the code, English name and native name, and creating the team
  adds the language and the team in one step (user, 2026-11-13). It runs the same step approval
  runs.
- **Deletes a team** from its row on `/admin/teams`, any team but English's first, after a dialog that
  lists what goes and asks for its slug (`TEAMS.md`, *Deleting a team*). Its packs come off the
  channel first, then its rows go, its log with them: the log was the team's alone, and a row with
  no team would be everyone's to read. The site log keeps one `team.deleted` row naming its
  languages and members and counting what went. Its text reports move to another team of the
  language, its open voice reports are closed, and a language it leaves with no team is switched
  off. Its audio files stay in their buckets,
  and its ElevenLabs pronunciation dictionary stays on the account.

## What approval does

| Language requested | Approval | Original text (`text`) |
|---|---|---|
| New code (jaJP) | Creates the language, switched on, and a team voicing it, with plain packs. Appears on the site without a deploy. | The requester's team: its admin becomes text maintainer and may grant `text` in it. |
| Known, with no team (hidden) | Adds the team and switches the language on. Its packs are plain only if its slug is the code. | The requester's team, as above. |
| Known, with a team (deDE) | Adds the team beside the others, equal to them. The language stays switched on or off as it was. | Stays with the text maintainers. The new team's admin gets `admin` alone. |

Approval never moves a language or its rows between teams. Requests are open for
every language, the official ones included (user).

## Decisions (user, 2026-11-12)

- Any registered user may request a team for a new language.
- **Approval is required** before the language goes live, and **the team stays locked until then**.
- **`text` goes with request-made languages only** (option A): when approval creates a language
  or hands over an unmaintained one, the team admin becomes its text maintainer and may grant
  `text` in it. Every other language keeps today's rule: only the site owner appoints text
  maintainers. Splitting text maintainers from teams is later work, if needed.
- **Requests are open for any language**, official ones included. An unmaintained language is
  handed over; a maintained one gets a second team with audio roles only.
- The API reads **text only**. English takes are not pullable. English reference text gets its own
  endpoint, `GET /api/v1/<section>/reference` (name may change if a better one fits).
- "Upload takes" means **generate** takes; the API gains a way to trigger generation.
- **Distribution is out of scope.** How a new language's audio reaches players (official packs,
  community packs, team storage) is later work; "bring your own storage" for teams is planned
  separately.

## Goals

- A stranger can go from registering to a live, approved team for a new language without a site
  owner doing anything but pressing Approve.
- A new language needs no code change and no deploy once approved.
- A self-made team's admin is as capable in their language as today's language admins, and can
  run the whole text-and-generation loop from a script.
- Every TTS credit spent is the spender's own, as today.

## Non-goals

- Distribution of a new language's audio to players: release packs, the Manager channel,
  CurseForge, community packs, team storage.
- The player side of a second team: pack ids, the Manager's index, primary/fallback choice in
  the addon, and reports carrying the team (all distribution).
- Quotas, abuse limits, review before a take goes live, terms of service (still open, as in
  TEAMS.md and PLAN.md).
- Downloading audio through the API.
- Login providers other than email and password.

## Anti-goals

- A pending request leaking anything: a language visible to players, text or takes generated
  before approval, a token that works before approval.
- A self-made team getting powers outside its language, or over other teams.
- Spending anyone's credits but the person who queued the job.
- Today's teams and maintainers noticing a change, beyond invites and anything the builder
  chooses to share with them.

## Constraints

- Every per-team query goes through `withTeam` / `ALL_TEAMS` (`apps/web/src/lib/db.ts`), under
  row-level security. Tests run as `spoken_app` on `spoken_ci_pin`, never `spoken_dev`.
- Migrations are plain SQL, additive, one transaction each.
- `team_language.lang` and `language.code` already accept any `^[a-z]{2}[A-Z]{2}$`.
- Generation keeps today's rules: no server-wide provider key; a queued job runs on its owner's
  key; the provider is fixed at enqueue (`apps/web/src/app/api/regenerate/queue/route.ts`).
- Nothing in the repo spends TTS credits (AGENTS.md); the generation endpoint is a site route
  driven by the caller's own key, like the Regenerate button.
- A new language has no client-derived data (contributions, gossip locale, area aliases), as
  itIT, plPL and viVN today (`client: false` in their rows).

## The big change: languages become data

Built. The site reads its languages from the database `language` table (name, native name, BCP 47
tag, provider language code, whether a client runs in it) into a registry each process caches
(`apps/web/src/lib/languages/catalogue.ts`). Every pm2 worker reloads it on a `NOTIFY`, so a
language a site admin adds is served without a deploy. `Lang` (`apps/web/src/lib/lang.ts`) is a
validated string, not a literal union, and the URL proxy matches a language prefix by its shape,
without a database call. The pipelines' list (`pipelines/lib/locales.mjs`) stays the authority for
the ten client locales.

A row also carries what code knows of a built-in language and a team's would otherwise lack
(migration 0125): `playerWords`, what its recordings say where the game writes `$N`, `$C` and `$R`,
and optionally a Craftsman's Writ's `$2oa` (`pipelines/lib/player-words.mjs`), and `bytesPerCharacter`, its width for fish.audio's list price
(`apps/web/src/lib/generation/calibration.ts`). A language with no words voices no line holding a
token: the text gate refuses it. Its text maintainers set them on `/<lang>/player-words`
(`PUT /api/languages/player-words?lang=`, `text`). A built-in language has default words in code;
its row's words, once saved, replace them, and clearing the row returns to them. They reach the registry with the rest of the row, and a pack build run by hand
registers them from the table (`PLAYER_WORDS_SQL` in `pipelines/lib/player-words.mjs`).

**Built in are the ten languages a game client runs in, and no others.** Italian, Vietnamese and
Polish were the project's until 2026-11-20, and are their teams' now: they left `locales.mjs`,
`lang.ts` `BUILTIN`, the store pages and the Manager's language list, and their words and
Vietnamese's byte width moved into their rows unchanged.

## Calls made without the user (check these)

- **Languages list.** The languages the project keeps stay in `pipelines/lib/locales.mjs`,
  which the pipelines keep using. The database `language` table gains the descriptive columns and
  is seeded with all of them; requested languages, and Italian, Vietnamese and Polish since they
  became their teams', exist only there. `lang.test.ts` becomes "every
  pipeline locale has a matching row". `Lang` stops being a literal union and becomes a validated
  string type. *(My call.)*
- **Tokens that generate.** A token gains a separate opt-in `generate` scope, beside `read` and
  `write`. Existing tokens never gain spending power. A `generate` token works while its owner
  holds `regenerate` in its language; text reads need `text` or `regenerate`, original writes need `text`, and override writes need `regenerate`. Each person creates
  their own tokens; an admin does not issue tokens for members. *(My call.)*

## Several teams in a language

A request for a language that has a team brings in the part of TEAMS.md *Phase 2* that lives on the
site. The rest of phase 2 is distribution and stays out.

- The new team is a `team_language` row like the first: a language's teams are equal. Its
  pack name, fixed when it joins, is `slug` (`packName`, TEAMS.md *A language's teams*): its packs
  carry its slug, so team `dragon`'s French places pack is `SpokenPlacesAudio_frFR_dragon`. Its
  takes, voices, clones, settings, lexicon, ignores, queue and activity are its own, isolated by the
  existing row-level security. A rejected contribution's ignore is the language's, and holds for
  every team.
- **Text layer.** The team cannot edit the original. Per-team overrides generalise `line_override`
  from quest lines to every source. The text a team voices is its override where present, else the
  original, and a take's staleness is judged against that; the text shown stays the original. The
  text API's writes from a non-text-maintainer team go to its override layer, under `regenerate`.
  *(My call: without this the team cannot change a word, and TEAMS.md already designs it.)*
- **One team per person per language.** A person works on a language in one team only. A deferred
  trigger on `team_member` enforces it, and the request, approval, grant and invite paths refuse
  it first with a message. *(User.)*
- **The start.** It inherits the original text; it never gets another team's takes or text
  overrides. The site owner chooses at approval whether its settings are a copy of the first
  team's (the one with plain packs, else the first by name) or fresh, fresh being the default. A copy brings
  settings only, never voice material. *(User.)*
- **Text maintainers** are independent of team membership: text reports and contributions follow
  the `text` grant, whatever team the maintainer works in. *(User.)*
- **A team's admin** sees only their own team's members, invites and grants, and the language's
  text maintainers. Its activity is filed under the team.
- **Tokens.** Only `text` writes the original text, in any language. A token reads its language's
  original text, with its owner's team's overrides, when its owner holds `text` or `regenerate`,
  and writes that team's overrides when its owner holds `regenerate`. Every token route acts as
  the owner's team. *(User.)*
- **The token's layer.** A write goes to the original or to the owner's team's overrides, chosen
  per request by a top-level `layer`. With none, a text maintainer's token writes the original, as
  it always did, and anyone else's writes the overrides; a maintainer who holds `regenerate` sends
  `"layer": "override"` for theirs. `"layer": "original"` without `text` is refused with 403.
  Undoing a run restores an override in the team that wrote it, and only for a write token whose
  owner holds `regenerate` now and acts as that team; otherwise the undo reports the override as
  skipped (`not_allowed`) and leaves it live. A site owner may undo any team's override.
  *(My call, set by the controller.)*
- **Gender splits.** Splitting a line by the reader's gender rewrites the original every team
  voices, so it takes `text`, whatever team its holder works in. A plain override is written into
  its own team's layer.
- **Explorer.** In a language with several teams, the places, bosses, readables and quests
  explorers show a "Team" picker listing every team that voices it, none marked: the one with
  plain packs first, then by name. The pick is `?team=<slug>` and chooses whose live takes play,
  anonymous visitors included. With none, the explorer plays the team the visitor works in, else
  the first listed, read-only for a visitor in none of them. A single-team language shows no
  picker.
- **Another team's view is read-only.** It plays that team's live takes and shows its override
  on a line with a live take that speaks it. Each line reads voiced or
  missing, with no stale, dirty, made-by, report or recording marks, and the regenerate,
  override, ignore, record, report and clear-mark controls are hidden. The pencil that writes the
  original stays, since the original is shared. A note says whose takes play, with a link back to the visitor's own view.
- **A site owner acts inside a team through the picker.** Their pick is kept per language in the
  `spoken_team` cookie, read only for a site owner, and every read and write in that language
  goes to the picked team until they pick again. An entry is kept only where it changes who they
  act as, so a site owner who is a member of one team can still act as another. With no entry, a
  site owner acts in their own team, else the first listed. While
  an entry holds, every page of the language shows "Working as {team}" with the picker. The queue
  panel shows each team only its own finished lines and pauses, and a site owner's Stop cancels
  pending work in every team of their languages.
- Contributions and text reports keep going to the text maintainers.

## Left to the builder

- The request form's fields beyond code, names and team name; validation of the code.
- How invites are stored, how long they last, and the email they send (password reset already
  sends email, `apps/web/src/lib/email.ts`).
- The exact shape of the generation endpoint (by filters, like the quests queue, or by line ids,
  like places), and how it reports batch progress.
- How the language cache is invalidated across pm2 workers (the team memo already uses `NOTIFY`).
- Order of work and staging.

## Follow-ups

- A later migration sets language `name`, `native`, `bcp47` and `provider` NOT NULL once no pre-0109 release runs.
- The CLI `apps/web/scripts/seed-voice-sources.mts` knows only the built-in languages; it does not load the registry.
- The queue panel's counts, failures and cursor still cut at the latest dismissal mark of any team, so one team's dismissal clears another's counts.
