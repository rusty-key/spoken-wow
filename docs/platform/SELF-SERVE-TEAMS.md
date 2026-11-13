# Self-serve teams

Design, 2026-11-12. Not yet planned or built. Builds on [`TEAMS.md`](TEAMS.md) phase 1.

## Why

Today a site owner creates every team by hand, and a language exists only if it is in the code
(`apps/web/src/lib/lang.ts`, `pipelines/lib/locales.mjs`). Someone who wants to voice a language
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
- **Approve** does one of three things, by the state of the language (below), and makes the
  requester the team's admin.
- **Reject** closes the request; the requester can see it was rejected.
- **Appoints text maintainers** for languages that already have them, as today.
- **Creates a team for a new language directly** from the New team form on `/admin/teams`: a
  "New language…" choice takes the code, English name and native name, and creating the team
  adds the language and the team in one step (user, 2026-11-13). It runs the same step approval
  runs.

## What approval does

| Language requested | Approval | Original text (`text`) |
|---|---|---|
| New code (jaJP) | Creates the language, switched on, and a team owning it. Appears on the site without a deploy. | The requester's team: its admin becomes text maintainer and may grant `text` in it. |
| Known, no active team (plPL, an empty itIT) | Hands the language over to the new team (`move_team_lang`), with its rows, roster and settings, and switches it on. | The requester's team, as above. |
| Known, with an active team (deDE) | Creates a **second team** in the language, beside the existing privileged one. | Stays with the text maintainers the site owner appoints. The new team gets audio capabilities only. |

"Active team" means a team holding the language with at least one member who is not a site owner.
*(My call; the builder may refine it.)* Requests are open for every language, the official ones
included (user).

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
  itIT, plPL and viVN today (`client: false`).

## The big change: languages become data

The list of languages is a literal in code today. The `Lang` type is that literal's union, the URL
proxy validates prefixes against it without a database call, and `lang.test.ts` keeps it in
step with `pipelines/lib/locales.mjs`. Approving a language without a deploy means the site reads
its languages from the database (name, native name, BCP 47 tag, provider language code, script,
whether a client runs in it), with a cache the proxy can use. The pipelines' list stays the
authority for the ten client locales.

## Calls made without the user (check these)

- **Languages list.** All thirteen languages known today stay in `pipelines/lib/locales.mjs`,
  which the pipelines keep using. The database `language` table gains the descriptive columns and
  is seeded with all thirteen; requested languages exist only there. `lang.test.ts` becomes "every
  pipeline locale has a matching row". `Lang` stops being a literal union and becomes a validated
  string type. *(My call.)*
- **Tokens that generate.** A token gains a separate opt-in `generate` scope, beside `read` and
  `write`. Existing tokens never gain spending power. A `generate` token works while its owner
  holds `regenerate` in its language; text reads and writes still need `text`. Each person creates
  their own tokens; an admin does not issue tokens for members. *(My call.)*

## Second team in a language

A request for a maintained language brings in the part of TEAMS.md *Phase 2* that lives on the
site. The rest of phase 2 is distribution and stays out.

- The second team is a non-privileged `team_language` row. Its takes, voices, clones, settings,
  lexicon, ignores, queue and activity are its own, isolated by the existing row-level security.
- **Text layer.** The team cannot edit the original. Per-team overrides generalise `line_override`
  from quest lines to every source. The text a team voices and shows is its override where present,
  else the original, and a take's staleness is judged against that. The text API's writes from a
  non-text-maintainer team go to its override layer. *(My call: without this the team cannot change
  a word, and TEAMS.md already designs it.)*
- **Explorer** gets a team picker per language, so either team's takes can be viewed.
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

- A later migration sets language `name`, `native`, `bcp47` and `provider` NOT NULL once no pre-0107 release runs.
- The CLI `apps/web/scripts/seed-voice-sources.mts` knows only the built-in languages; it does not load the registry.
- Listener state is per module instance, so each process opens two LISTEN connections.
