# AGENTS.md

Repo-wide rules. Each section also has its own file, which applies on top of this one:
`docs/quests/CLAUDE.md`, `docs/zones/AGENTS.md`, `docs/books/AGENTS.md`.

## Layout

- `addons/`: the shipped Lua.
  - `Spoken` plays every line. `Spoken_Quests`, `Spoken_Zones` and `Spoken_Books` are its
    modules, and `SpokenContributions` holds what players upload at /contribute. All five
    ship in one zip, `Spoken-<v>.zip` (`scripts/spoken/package.sh`).
  - `SpokenZonesAudio` and `SpokenBooksAudio` are sound packs. The quests packs have no folder
    here; they are built into `pipelines/quests/audio/`, which is gitignored.
  - `SpokenPlayer`, `SpokenQuests`, `SpokenZones` and `SpokenBooks` are tombstones: a `.toc`
    and no Lua, so an update replaces an old install with a folder that never loads. Never
    add code to them.
- `apps/web`: the site, `spoken.rusty.one`, a Next.js app backed by Postgres. It imports
  `pipelines/zones` and `pipelines/books` (`@tools/*` and `@books-tools/*`), so a change there is
  a change to the site.
- `pipelines/`: `quests` is Python, `zones` and `books` are Node, and `lib` holds the `.mjs`
  modules they and the site share.
- `publishers/<section>/*.md`: every store page. `make descriptions` regenerates the READMEs
  built from them; never edit a generated README by hand.
- `deploy/web`: the `/srv` tree, nginx vhosts, migrations runner and runbook.
- `docs/<section>/`: each section's README, changelog and agent guide. `docs/spoken/` is
  Spoken's.

## Branches and checks

`develop` is where work lands: open the PR against it. Merging needs one approval from
another collaborator and the four CI jobs green. Only the admin merges into `master`, and a
push to `master` that touches the site's inputs deploys production
(`.github/workflows/deploy-web.yaml`).

Run what your change touches before pushing:

```sh
make test-player   # addons' Lua tests (needs luajit)
make test          # all of it: Lua, web, Node scripts, quests pytest (venv at pipelines/quests/.venv)
make lint          # what CI gates on: typecheck, addon XML, zones validation, store pages, locale strings
```

Several web tests need a real, migrated Postgres, because the invariants they protect live in
schema constraints. The CI `web` job shows the setup.

## Rules that are load-bearing

**Nothing in the repo spends TTS credits** (ElevenLabs or fish.audio). Lines are voiced on the
droplet, through the site. Do not add a generation flag to a CLI. `make zones-lore-rewrite` does spend Claude
credits, even with `--dry-run`.

**Data only comes home from production.** The take archive (`audio-history/`) is the only
audio and only the site writes it. The `<section>-pull-*` targets never delete anything.
The `<section>-sync` targets replace local tables and are destructive, so confirm before
running one. `sounds` directories are assembled from the live takes before a build and are
never the record. Audio stays out of git; `.gitignore` says which directories cannot be
reproduced. Never prune those.

**The droplet is never named in the tree.** Host, user and key come from the environment
(`make/droplet.mk`) locally and from the `DO_*` secrets in CI.

**Ids and filenames are frozen.** `q:{questID}:{accept|progress|complete}`, `g:{md5}`,
`f:{broadcastTextID}:{voice}` (each with an optional `:m`/`:f` suffix), `z:{mapID}`,
`s:{mapID}:{key}`, `b:{pageTextID}`, and the paths derived from them. Renaming one re-ships a
pack every player has downloaded and orphans the take history. Each is derived in exactly one
place: `pipelines/quests/tts_cli/naming.py` (mirrored by
`apps/web/src/lib/contributions/naming.ts`), `pipelines/zones/tools/voice/naming.mjs` and
`pipelines/books/tools/lib/naming.mjs`.

**Migrations are forward-only and additive.** Deploy migrates before the symlink swap and
rollback restores code without reverting the schema.

**The `make/*.mk` files stay separate.** They share many target names, and the root `Makefile`
dispatches `quests-*`, `zones-*`, `books-*` and `web-*` to them. Each target is commented with
the failure it prevents; read that comment before changing one.

**Shared credentials live in the repo-root `.env`** (`.env.example` lists them).
`pipelines/<name>/.env` and `apps/web/.env.local` override it, and should hold only what is
theirs alone. A shared variable copied into one of them drifts.

## Versions and changelogs

A change that players see bumps a version and writes its changelog section in the same PR.
Tooling, the site, CI and docs bump nothing.

- Spoken, its modules, `SpokenContributions` and the tombstones move together, in every
  `.toc`, both `Environment.lua` `AddonVersion` literals included. Their notes go in
  `docs/spoken/CHANGELOG.md`, and they release as the `spoken/vX` tag.
- Sound packs version on their own, with sections in their section's changelog.
- Release scripts look for the exact `## <version>` heading and fail without it. Write the
  real version heading with its date, never "Unreleased".

## Working agreements

- Do what was asked, at the scope intended. If a better approach exists, say so in a sentence
  and still do the task as asked. Regenerating content because it seemed related is scope
  creep.
- The checks above are the verification. Do not stack extra self-review passes or use
  subagents to re-check finished work.
- PR descriptions are prose for the reviewer and for whoever finds the branch in a year. The
  title states the outcome. Open with the problem, record the decisions you rejected, and
  include an honest verification section that says what you did not check (for example,
  "not looked at in-game").

## Comments

Comment the *why*, never the *what*: name the failure a line prevents, not what the line
does. No commented-out code, no history, no pointers to sibling code.
`.claude/skills/comment-cleanup/SKILL.md` has the full rules; run `/comment-cleanup` in Claude
Code before asking for review.
