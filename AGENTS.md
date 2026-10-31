# AGENTS.md

Repo-wide rules. Each section also has its own file, which applies on top of this one:
`docs/quests/CLAUDE.md`, `docs/gossip/AGENTS.md`, `docs/places/AGENTS.md` (Spoken Places), `docs/readables/AGENTS.md` (Spoken Readables).
Gossip, in `Spoken_Quests`, reads the `g:` lines the quests pipeline builds, so the quests guide
covers how they are made. Spoken has no guide; `docs/spoken/` holds its changelog and reference pages.

## Layout

- `addons/`: the shipped Lua.
  - `Spoken` plays every line. `Spoken_Quests`, `Spoken_Places`, `Spoken_Readables` and
    `Spoken_Bosses` are its modules, and `SpokenContributions` holds what players upload at
    /contribute. All six ship in one zip, `Spoken-<v>.zip` (`scripts/spoken/package.sh`).
    The bosses' data is covered by the Places guide (`docs/places/BOSSES.md`), the module by
    `docs/bosses/README.md`.
  - `Spoken_Developer` is for developers only: the debug log and the Developer page. It is
    not in Spoken's zip and has no store page or release; a developer links it from a checkout
    or builds it with `scripts/developer/package.sh` (`addons/Spoken_Developer/README.md`).
  - `SpokenPlacesAudio`, `SpokenReadablesAudio` and `SpokenBossesAudio` are sound packs. The
    quests packs have no folder here; they are built into `pipelines/quests/audio/`, which is
    gitignored.
- `apps/web`: the site, `spoken.rusty.one`, a Next.js app backed by Postgres. It imports
  `pipelines/places` and `pipelines/readables` (`@tools/*` and `@readables-tools/*`), so a change there is
  a change to the site.
- `pipelines/`: `quests` is Python, `places` and `readables` are Node, and `lib` holds the `.mjs`
  modules they and the site share.
- `publishers/<section>/*.md`: every store page. `make descriptions` regenerates the READMEs
  built from them; never edit a generated README by hand.
- `deploy/web`: the `/srv` tree, nginx vhosts, migrations runner and runbook.
- `docs/<section>/`: each section's README, changelog and agent guide. `docs/spoken/` is
  Spoken's.

## Branches and checks

`master` is where work lands: open the PR against it. Merging needs the four CI jobs green,
and only the admin merges. A merge into `master` that touches the site's inputs deploys
production (`.github/workflows/deploy-web.yaml`).

Run what your change touches before pushing:

```sh
make test-player   # addons' Lua tests (needs luajit)
make test          # all of it: Lua, web, Node scripts, quests pytest (venv at pipelines/quests/.venv)
make lint          # static checks: typecheck, addon XML, changelog, places validation, store pages, locale strings
```

CI (`.github/workflows/ci.yaml`) runs four jobs, each only when the paths it reads changed:
addons, quests pipeline, web, and places pipeline. Between them they run the pieces of those
commands, not the commands. `make lint` also checks the places language files
(`build-languages.mjs --check`), which CI does not. CI also runs the Lua block-balance check
(`make places-lint`), which `make lint` does not. Run both before pushing a change to either.

Several web tests need a real, migrated Postgres, because the invariants they protect live in
schema constraints. The CI `web` job shows the setup.

## Rules that are load-bearing

**Nothing in the repo spends TTS credits** (ElevenLabs or fish.audio). Lines are voiced on the
droplet, through the site. Do not add a generation flag to a CLI. `make places-lore-rewrite` does spend Claude
credits, even with `--dry-run`.

**Data only comes home from production.** The take archive is the only audio and only the
site writes it: `audio-history/` on the droplet's volume, and the `spoken-archive` R2 bucket,
whose objects are named by their SHA-256 (`apps/web/src/lib/blobs/store.ts`). Nothing deletes
from the bucket's `takes/` or `recordings/`. The `<section>-pull-*` targets never delete anything.
The `<section>-sync` targets replace local tables and are destructive, so confirm before
running one. `sounds` directories are assembled from the live takes before a build and are
never the record. Audio stays out of git; `.gitignore` says which directories cannot be
reproduced. Never prune those.

**The database is the source of truth; committed data files are exports of it.** Text and
structure live in Postgres (`quest_line`, `book_page`/`book_line`, `lore_line` and the rest), and
the site edits them. `corpus.json.gz`, `Books.lua`, the Places `Zones.lua`/`Subzones.lua` and
every file headed "AUTO-GENERATED" come out of a database or a generator through a make target.
Never edit one by hand, merge rows into one, or fill one from the site's public API: the next
export overwrites the change, and until then the repo and the site disagree. Fix a wrong line
in the database and export it again, and fix a wrong file in its generator. If you cannot reach
the database, change only code, tests and hand-kept inputs (the section guides list them), and
say in the PR which database change and which export are needed.

**The droplet is never named in the tree.** Host, user and key come from the environment
(`make/droplet.mk`) locally and from the `DO_*` secrets in CI.

**Ids and filenames are frozen.** `q:{questID}:{accept|progress|complete}` (and its other wordings, `…:w{n}`), `g:{md5}`,
`g:b{broadcastTextID}-{voice}`, `g:{lang}-{md5}`, `f:{broadcastTextID}:{voice}` (each with an optional `:m`/`:f` suffix), `z:{mapID}`,
`s:{mapID}:{key}`, `b:{pageTextID}`, the minted `b:n{uuid}` (a page only a player's client has
shown) and its book's `n{uuid}`, and the paths derived from them. A minted page later found in
the world database folds into the real one, and its id stays behind as an alias. Renaming one
re-ships a pack every player has downloaded and orphans the take history. Each is derived in exactly one
place: `pipelines/quests/tts_cli/naming.py` (mirrored by
`apps/web/src/lib/contributions/naming.ts`), `pipelines/places/tools/voice/naming.mjs` and
`pipelines/readables/tools/lib/naming.mjs`.

**Migrations are forward-only and additive.** Deploy migrates before the symlink swap and
rollback restores code without reverting the schema.

**The `make/*.mk` files stay separate.** They share many target names, and the root `Makefile`
dispatches `quests-*`, `places-*`, `readables-*` and `web-*` to them. Each target is commented with
the failure it prevents; read that comment before changing one.

**Shared credentials live in the repo-root `.env`** (`.env.example` lists them).
`pipelines/<name>/.env` and `apps/web/.env.local` override it, and should hold only what is
theirs alone. A shared variable copied into one of them drifts.

## Versions and changelogs

Only a release PR bumps a version. Any other PR with a change that players see adds its notes
under `## Unreleased` at the top of the changelog, creating that heading if it is missing.
Tooling, the site, CI and docs add no notes.

A release PR bumps the version and renames `## Unreleased` to the real version heading with
its date.

- Spoken, its modules and `SpokenContributions` move together, in every `.toc`, both
  `Environment.lua` `AddonVersion` literals included. Their notes go in
  `docs/spoken/CHANGELOG.md`, and they release as the `spoken/vX` tag.
- Sound packs version on their own, with sections in their section's changelog.
- `Spoken_Developer` has its own version, and nothing releases it.
- Release scripts look for the exact `## <version>` heading and fail without it, so a release
  must not ship with the notes still under `## Unreleased`.

## Working agreements

- Do what was asked, at the scope intended. If a better approach exists, say so in a sentence
  and still do the task as asked. Regenerating content because it seemed related is scope
  creep.
- The checks above are the verification. Do not stack extra self-review passes or use
  subagents to re-check finished work.

## PR descriptions

A PR description is prose for the reviewer and for whoever finds the branch in a year. Aim for
about 200 words. The title states the outcome.

Include:

- Why the change exists and what limits it, followable with no prior context.
- How it works, only where the diff doesn't show it. Say where the risk sits so the reviewer
  looks there.
- Deliberate omissions, and why.
- Verification as facts only: what ran, what passed, what was not checked (for example, "not
  looked at in-game").
- A "How to test" section that lets the reviewer check the change themselves. For a bug fix, the
  steps to reproduce it in game: where to go, what to click, what went wrong before and what
  happens now. For a new feature, screenshots, or instructions for finding and trying it.

Leave out:

- Per-change or per-file lists. The files tab has them.
- History: review rounds, fix-ups, what an earlier version got wrong, dropped designs.
- Why it is a separate PR ("stacked on #X", "part 2 of 4", what it unblocks). The base branch
  and labels carry ordering.
- Tool attribution such as "Generated with Claude Code" and session links. Commit trailers
  stay.

Write plain words in active voice and short sentences. No em dashes, no filler, no bold labels
that restate the line. Keep identifiers, flags and issue numbers exact.

## Comments

Comment the *why*, never the *what*: name the failure a line prevents, not what the line
does. No commented-out code, no history, no pointers to sibling code.
`.claude/skills/comment-cleanup/SKILL.md` has the full rules; run `/comment-cleanup` in Claude
Code before asking for review.
