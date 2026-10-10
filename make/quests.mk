# Droplet plumbing and packaging for the quests addon and its sound packs.
#
# The audio is the take archive (audio-history/), gitignored and never through CI. Takes
# are cut on the droplet, through the site, so it only ever comes home -- `make pull-history`
# -- to be built into a pack.
#
# The host, the deploy user and the key come from make/droplet.mk, which reads them
# out of the environment. Override for one invocation with DROPLET=deploy@<host>.
include make/droplet.mk


# /srv/spoken, not /srv/voiceover. The cutover has run: the voices and the take archive
# live under /srv/spoken/shared (symlinks into the block volume at
# /mnt/voice/spoken), the `spoken` pm2 app is what serves them, and `voiceover` is stopped.
# Pointing these at the old tree is not an error rsync can report -- it finds a complete,
# consistent store there and syncs happily against a site nobody is using, which is how a
# fortnight of regenerated takes went unnoticed.
REMOTE_VOICES := $(REMOTE_ROOT)/shared/voices/
# Quests' own archive under the shared audio-history -- the directory
# SPOKEN_QUESTS_AUDIO_HISTORY names in deploy/web/ecosystem.config.js. The root holds all
# three sections; syncing against it would mix them.
REMOTE_HISTORY := $(REMOTE_ROOT)/shared/audio-history/quests/
REMOTE_PM2   := pm2

# Passed straight through to scripts/package-audio.sh, which documents each one. Empty
# means the script's own default, so `make pack` needs no arguments to do the usual thing.
VERSION ?=
ENCODE  ?=
JOBS    ?=

# The pipeline's own interpreter, and its own directory: cli-main.py and the venv are under
# pipelines/quests/, while every path in this file is relative to the repo root because the
# dispatcher runs it from there. Resolving .venv/bin/python against the root found nothing,
# fell back to the system python3, and every target calling the CLI died on a
# cli-main.py that was never there -- the one thing the merge moved and this did not follow.
QUESTS_DIR   := pipelines/quests
PYTHON       ?= $(shell [ -x $(QUESTS_DIR)/.venv/bin/python ] && echo $(abspath $(QUESTS_DIR)/.venv/bin/python) || command -v python3)

# macOS ships openrsync as /usr/bin/rsync, which reports itself as "2.6.9 compatible" and
# rejects --info. Prefer a real rsync 3.x anywhere on PATH.
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)


# Fail with an explanation rather than an rsync usage dump or a silent no-op reload.
define preflight
	@[ -n "$(RSYNC)" ] || { echo "No rsync 3.x found. macOS ships openrsync, which lacks --info."; \
	                        echo "Install one:  brew install rsync"; exit 1; }
	@case "$(DROPLET)" in root@*) \
	  echo "DROPLET is $(DROPLET). Use deploy@ instead: pm2 daemons are per-user, so a"; \
	  echo "reload as root finds no 'voiceover' process and the new audio stays invisible."; \
	  exit 1;; esac
endef

.DEFAULT_GOAL := help
.PHONY: help pull-voices push-voices voices-status \
        pull-history pull-live pull-recorded package-acted acted history-status sounds package package-audio \
        package-audio-complete package-meta push-complete icon \
        downloads-status \
        factions followup-lines release release-audio release-audio-dry release-wago release-curse \
        release-dry import-corpus import-locale fill-locales import-questit export-corpus export-ignores export-locale-text export-giver-names export-gossip-text \
        sync check-synced full-release

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# --- addon tests ----------------------------------------------------------------------

# The player's quest dispatch, run against a stubbed client. LuaJIT is the interpreter
# because it speaks the 5.1 the game does, including setfenv, which every addon file calls.
# test-player moved to the root Makefile: tests/lua/ is shared by every addon now,
# not just this one.

# --- voice clips ----------------------------------------------------------------------
#
# The clips a voice was cloned from. Small (kilobytes each) but irreplaceable: an ElevenLabs
# voice cannot be exported, so losing these means a voice can never be remade - the exact
# failure that left this project with inherited voices it could not reproduce.
#
# Uploads happen on the droplet through the web UI, so the droplet is usually the newer
# side. Neither target uses --delete for that reason: these are two
# collections being kept in sync by hand, not a mirror with an authoritative side.

pull-voices: require-droplet ## Fetch voice clips from the droplet (non-destructive)
	$(preflight)
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		$(DROPLET):$(REMOTE_VOICES) pipelines/quests/voice/samples/
	@echo "==> pulled into pipelines/quests/voice/samples/"

push-voices: require-droplet ## Upload voice clips to the droplet (non-destructive)
	$(preflight)
	@[ -d pipelines/quests/voice/samples ] || { echo "no pipelines/quests/voice/samples/ to push"; exit 1; }
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		pipelines/quests/voice/samples/ $(DROPLET):$(REMOTE_VOICES)
	@echo "==> pushed"

voices-status: require-droplet ## Compare clip count and size on both sides
	@echo "local:  $$(find pipelines/quests/voice/samples -type f 2>/dev/null | wc -l | tr -d ' ') clips, $$(du -sh pipelines/quests/voice/samples 2>/dev/null | cut -f1 || echo 0)"
	@$(SSH) $(DROPLET) 'echo "remote: $$(find $(REMOTE_VOICES) -type f 2>/dev/null | wc -l | tr -d " ") clips, $$(du -sh $(REMOTE_VOICES) 2>/dev/null | cut -f1)"'

# --- take archive -------------------------------------------------------------------
#
# Every take of every line, the live one included: the only quests audio there is, and the
# one directory whose loss is permanent, since some of it predates this project's ability to
# reproduce it. Takes are cut on the droplet, through the site, so it only ever comes home,
# and never with --delete.

pull-history: require-droplet ## Fetch the droplet's archived takes (non-destructive)
	$(preflight)
	$(RSYNC) -a --partial --human-readable --info=progress2 -e "$(SSH)" \
		$(DROPLET):$(REMOTE_HISTORY) pipelines/quests/audio-history/
	@echo "==> pulled into pipelines/quests/audio-history/. Build a pack's audio with:  make quests-sounds"

# Only the takes a pack is built from: the live ones, as the local database has them, so run
# `make quests-sync` first. pull-history is the whole archive, for listening to old takes.
pull-live: require-droplet ## Fetch only the live takes the local database names (after sync)
	$(preflight)
	@$(DB_ENV) RSYNC="$(RSYNC)" scripts/audio/pull-live.sh quests $(or $(LOCALE),enUS)

history-status: require-droplet ## Compare take count and size on both sides
	@echo "local:  $$(find pipelines/quests/audio-history -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ') takes, $$(du -sh pipelines/quests/audio-history 2>/dev/null | cut -f1 || echo 0)"
	@$(SSH) $(DROPLET) 'echo "remote: $$(find $(REMOTE_HISTORY) -name "*.mp3" 2>/dev/null | wc -l | tr -d " ") takes, $$(du -sh $(REMOTE_HISTORY) 2>/dev/null | cut -f1)"'

# The folder a pack is built from, pipelines/quests/audio/: not kept, but assembled from the
# live takes and the archive before every build. See scripts/audio/sounds.mjs.
sounds: ## Assemble pipelines/quests/audio from the live takes and the archive
	@$(DB_ENV) node scripts/audio/sounds.mjs --lang=$(or $(LOCALE),enUS) quests

# The voice actors' recordings (migration 0062) ship as an overlay pack of their own, which the
# player prefers over the generated pack where it has a line. Built from the `recording` table
# and the files under the archive's recorded/, not from the takes. See scripts/audio/acted.mjs.
pull-recorded: require-droplet ## Fetch the voice actors' live recordings the local database names (after sync)
	@$(DB_ENV) RSYNC="$(RSYNC)" scripts/audio/pull-live.sh quests $(or $(LOCALE),enUS) recorded

package-acted: check-synced ## Build the voice-acted overlay zip into dist/ (LOCALE=xx, ACTED_VERSION=x.y.z)
	@$(DB_ENV) node scripts/audio/acted.mjs --lang=$(or $(LOCALE),enUS) --version=$(or $(ACTED_VERSION),1.0.0) quests

acted: pull-recorded package-acted ## Pull the recordings and build the voice-acted overlay (after sync)

# --- packaging ------------------------------------------------------------------------
#
# Two zips built on their own schedules, which is why they are two targets: most changes to
# the player touch no voiceline, and the sound pack is three orders of magnitude larger.
#
# `package` takes its version from `## Version:` in Spoken_Quests.toc, so bumping the addon
# and naming the zips stay one edit. It refuses to build from an uncommitted tree, because a
# zip nobody can trace back to a commit is a zip nobody can rebuild - ALLOW_DIRTY=1 to
# override while testing. Four zips come out: one for Blizzard's clients, which pick a .toc by
# flavor suffix, and one apiece for 1.12, 2.4.3 and 3.3.5, which read Spoken_Quests.toc and
# nothing else and each need their own vendored Ace3 in it. Only the first goes to CurseForge;
# the GitHub release workflow publishes all four.
#
# `package-audio` builds the store into five packs - Alliance, Horde, the quests both sides
# share, gossip, and one holding everything - and zips each. Ogg Vorbis at the full 44.1 kHz,
# around 300 MB a pack. Its own header explains every choice; VERSION goes into each TOC,
# PACKS=all builds only the complete one, ENCODE=copy skips the transcode to hear the masters
# in game, JOBS=1 makes a failing encode readable.
#
# ONE PACK FORMAT. A second set at half the size shipped alongside these for a while, five
# CurseForge projects of its own, because an addon manager installs a project's newest file and
# one project holding two formats would move a player out of the one they picked. That is over:
# those five projects stay published and are never uploaded to again, and nothing here builds
# them. docs/pack-size.md is where every encode that was considered was measured.

# The AddOns list reads a TGA or BLP, never the PNGs in pipelines/quests/assets/icon/, so the
# icon is converted and committed. Two marks, not one: the player wears the play triangle and
# Spoken Quests the exclamation mark, since they sit next to each other in that list. The five
# sound packs take the Quests mark -- scripts/quests/package-meta.sh and tts_cli/build.py copy
# spoken-quests.tga into every module they build.
# The minimap button wears the same player mark from a tighter crop, as a BLP rather than a
# TGA: a texture a frame loads is BLP on every client this ships to. LibDBIcon draws its own
# round border around it, so the crop drops the shield's octagonal frame -- two frames at 17
# pixels is mud. pipelines/quests/tools/make_minimap_icon.py says why each number is what it is.
icon: ## Rebuild the addons' icon.tga and the minimap BLP from pipelines/quests/assets/icon/*-512.png (needs ffmpeg)
	@python3 pipelines/quests/tools/make_icon.py pipelines/quests/assets/icon/spoken-player-512.png pipelines/quests/assets/icon/spoken-player.tga
	@python3 pipelines/quests/tools/make_icon.py pipelines/quests/assets/icon/spoken-quests-512.png pipelines/quests/assets/icon/spoken-quests.tga
	@cp pipelines/quests/assets/icon/spoken-player.tga addons/Spoken/icon.tga
	@cp pipelines/quests/assets/icon/spoken-quests.tga addons/Spoken_Quests/icon.tga
	@echo "==> copied into addons/Spoken/ and addons/Spoken_Quests/"
	@python3 pipelines/quests/tools/make_minimap_icon.py pipelines/quests/assets/icon/spoken-player-512.png addons/Spoken/Textures/MinimapButton.blp

package: ## Zip the player addon into dist/: one Blizzard zip, one per legacy client
	@./scripts/quests/package.sh

# Languages no client runs in (pipelines/lib/locales.mjs, `client: false`). Their packs carry
# no gossip locale text: the addon matches gossip by what the client shows, which is never in
# them. Recursive, so only a target that reads it pays for the node start.
NON_CLIENT_LOCALES = $(shell node --input-type=module -e 'const { LOCALES } = await import("./pipelines/lib/locales.mjs"); console.log(LOCALES.filter((l) => l.client === false).map((l) => l.code).join(" "))')

package-audio: check-synced export-corpus export-ignores $(if $(filter-out enUS $(NON_CLIENT_LOCALES),$(LOCALE)),export-locale-text) sounds ## Transcode, build and zip the four split packs, and bundle them into one zip for GitHub, into dist/ (VERSION=1.4.0)
	@VERSION=$(VERSION) ENCODE=$(if $(ENCODE),$(ENCODE),ogg-q0-44k) MODULE=SpokenQuestsAudio \
	  LANGUAGE="$(or $(LOCALE),enUS)" JOBS=$(JOBS) ./scripts/quests/package-audio.sh

# Every line in one folder rather than split five ways, ~1.3 GB. Not a CurseForge release - it
# is over the upload ceiling and always will be - so it is built for people who would rather
# take one download, and it is a folder of its own rather than a fatter copy of a shipping pack,
# so installing it beside them is possible but pointless. The site hosts it: `push-complete`
# below, under the one current name -- see the note there.

package-audio-complete: check-synced export-corpus export-ignores sounds ## Build the whole corpus as one folder for the site (~1.3 GB)
	@VERSION=$(VERSION) ENCODE=ogg-q0-44k PACKS=all \
	  MODULE_NAME=SpokenQuestsAudioComplete TITLE="Spoken Quests Audio: Complete" \
	  JOBS=$(JOBS) ./scripts/quests/package-audio.sh

# The "install everything" addon, which installs nothing itself: a few kilobytes declaring the
# four packs as CurseForge dependencies, because the complete pack is too big to upload. Its
# header explains the rest; release.sh sends the dependency list with the file.
#
# NAME is the bare pack-family folder, which the split packs leave free, and which release.sh
# uploads as audio-all.

package-meta: ## Zip the meta addon that pulls in all four packs
	@VERSION=$(VERSION) NAME=SpokenQuestsAudio ./scripts/quests/package-meta.sh

# The complete pack's home, since it is too big for CurseForge: nginx serves
# /srv/spoken/shared/downloads/ straight off disk (see deploy/web/nginx-spoken.conf), and
# this puts a freshly built zip there.
#
# The version comes from the built module rather than a variable, so pushing a pack nobody
# built fails here instead of uploading whatever zip is oldest in dist/. -latest.zip is a
# symlink repointed after the copy: the published URL never changes, and it never points at a
# half-transferred file because rsync writes to a temporary name and renames.
#
# ONE NAME. The pack was published as VoiceOverReduxAudioHQ-latest.zip before the rename, and
# that URL is not kept alive: the descriptions that carried it are being re-pasted with the
# current one, and the pack itself is re-downloaded this release whatever its name.

# What nginx-spoken.conf serves at /downloads/. voiceover.rusty.one is a redirect vhost now,
# so a zip pushed into the old tree would land in a directory nothing answers from.
REMOTE_DOWNLOADS := $(REMOTE_ROOT)/shared/downloads

push-complete: require-droplet ## Upload the built complete pack to the site's downloads directory
	@[ -n "$(RSYNC)" ] || { echo "No rsync 3.x found. brew install rsync"; exit 1; }
	@v=$$(sed -n 's/^## Version:[[:space:]]*//p' dist/SpokenQuestsAudioComplete/SpokenQuestsAudioComplete.toc 2>/dev/null | head -1); 	[ -n "$$v" ] || { echo "No complete module built. Run: make package-audio-complete"; exit 1; }; 	zip=dist/SpokenQuestsAudioComplete-$$v.zip; 	[ -f "$$zip" ] || { echo "$$zip is missing. Run: make package-audio-complete"; exit 1; }; 	echo "==> $$zip -> $(DROPLET):$(REMOTE_DOWNLOADS)/"; 	$(RSYNC) -a --human-readable --info=progress2 -e "$(SSH)" "$$zip" $(DROPLET):$(REMOTE_DOWNLOADS)/; 	$(SSH) $(DROPLET) "ln -sfn SpokenQuestsAudioComplete-$$v.zip $(REMOTE_DOWNLOADS)/SpokenQuestsAudioComplete-latest.zip"; 	echo "==> https://spoken.rusty.one/downloads/SpokenQuestsAudioComplete-latest.zip"

downloads-status: require-droplet ## List what the site is offering for download
	@$(SSH) $(DROPLET) 'ls -lh $(REMOTE_DOWNLOADS)/'

# `release` uploads whatever is already in dist/ to CurseForge - it builds nothing, so the
# zip it sends is the one you tested. The player's version comes from its .toc and the pack's
# from the module last built, and each looks its own section up in CHANGELOG.md. Needs
# CURSEFORGE_TOKEN in the repo-root .env. Always worth a release-dry first: it resolves the game versions
# and prints every file and note without sending anything.

# The faction split the packs are cut along. Needs the vmangos world DB up
# (`docker compose up -d mysql`), which is the only thing in this repo that does - the export
# is committed so that building a pack never needs a database. pipelines/quests/tools/export_factions.py
# explains how a quest gets a side.

factions: ## Re-export pipelines/quests/corpus/factions.json from the world DB (needs MySQL)
	@$(PYTHON) pipelines/quests/tools/export_factions.py

# What NPCs say in chat after a quest is accepted or turned in, from the world DB's quest
# scripts. Committed as addon Lua for the same reason factions.json is committed: packaging the
# addon must never need MySQL. pipelines/quests/tools/export_followup_lines.py explains who speaks.

followup-lines: ## Re-export addons/Spoken_Quests/FollowupLines.lua from the world DB (needs MySQL)
	@$(PYTHON) pipelines/quests/tools/export_followup_lines.py

release-dry: ## Show what `make release` would upload to CurseForge and Wago
	@./scripts/quests/release.sh --dry-run

release: ## Upload the built zips to CurseForge and Wago (needs both tokens)
	@./scripts/quests/release.sh

# The packs alone, for when the audio was rebuilt and the player was not. The meta addon comes
# last, since CurseForge resolves its dependencies at upload time. A language has no meta addon
# -- audio-all is the "install everything" addon for the four English projects, and a language's
# four packs are dependency-free, so LOCALE releases only them.
PACKS_AUDIO := audio-alliance audio-horde audio-shared audio-gossip

ifneq ($(filter-out enUS,$(LOCALE)),)
release-audio-dry: ## Show what uploading the four packs would send (and, for English, the meta addon); LOCALE=xx for a language's
	@./scripts/quests/release.sh --dry-run --lang=$(LOCALE) $(PACKS_AUDIO)

release-audio: ## Upload the four packs (and, for English, the meta addon); LOCALE=xx for a language's
	@./scripts/quests/release.sh --lang=$(LOCALE) $(PACKS_AUDIO)
else
release-audio-dry:
	@./scripts/quests/release.sh --dry-run audio-alliance audio-horde audio-shared audio-gossip audio-all

release-audio:
	@./scripts/quests/release.sh audio-alliance audio-horde audio-shared audio-gossip audio-all
endif

# The whole pack release, from production's data to the stores, with one question before
# anything is uploaded. Each step is its own target and still runs alone; this is their order.
#
# VERSION is required for English, not defaulted: package-audio.sh would otherwise stamp its own
# default, and a release under a number already on CurseForge is a duplicate file there. It needs
# a `## <VERSION>` pack section in docs/quests/CHANGELOG.md, which both uploads quote. A
# language's version comes from its page under publishers/quests/ instead, so LOCALE needs none.
#
# The packs never go to Wago, which answers 413 to a file this size (scripts/lib/wago.sh), and
# GitHub is where a Wago player gets them. English's four split packs go to CurseForge, and the
# same four bundled into one zip to GitHub; a language's one pack goes to GitHub, and to
# CurseForge once it has a project. English's meta addon is kilobytes and goes to both stores; a
# language has none. The complete pack for the site is not built here: it is another 1.3 GB, and
# `make quests-package-audio-complete push-complete` is the step if it is wanted.
ifneq ($(filter-out enUS,$(LOCALE)),)
full-release: require-droplet ## Sync, pull live takes, build and upload the packs (VERSION=2.1.0; LOCALE=xx for a language's)
	@$(MAKE) --no-print-directory -f make/quests.mk sync
	@$(MAKE) --no-print-directory -f make/quests.mk pull-live LOCALE=$(LOCALE)
	@$(MAKE) --no-print-directory -f make/quests.mk package-audio LOCALE=$(LOCALE)
	@./scripts/quests/release.sh --dry-run --store=curseforge --lang=$(LOCALE) $(PACKS_AUDIO)
	@./scripts/audio-github-release.sh --dry-run quests $(LOCALE)
	@printf 'Upload quests packs to CurseForge and GitHub? [y/N] '; \
	  read -r answer; [ "$$answer" = y ] || { echo aborted; exit 1; }
	@./scripts/quests/release.sh --store=curseforge --lang=$(LOCALE) $(PACKS_AUDIO)
	@./scripts/audio-github-release.sh quests $(LOCALE)
else
full-release: require-droplet
	@[ -n "$(VERSION)" ] || { echo "VERSION is required:  make quests-full-release VERSION=2.1.0"; exit 1; }
	@$(MAKE) --no-print-directory -f make/quests.mk sync
	@$(MAKE) --no-print-directory -f make/quests.mk pull-live
	@$(MAKE) --no-print-directory -f make/quests.mk package-audio
	@$(MAKE) --no-print-directory -f make/quests.mk package-meta
	@./scripts/quests/release.sh --dry-run --store=curseforge $(PACKS_AUDIO)
	@./scripts/quests/release.sh --dry-run audio-all
	@./scripts/audio-github-release.sh --dry-run quests $(or $(LOCALE),enUS)
	@printf 'Upload quests packs $(VERSION) to CurseForge and GitHub? [y/N] '; \
	  read -r answer; [ "$$answer" = y ] || { echo aborted; exit 1; }
	@./scripts/quests/release.sh --store=curseforge $(PACKS_AUDIO)
	@./scripts/quests/release.sh audio-all
	@./scripts/audio-github-release.sh quests $(or $(LOCALE),enUS)
endif

# --- the ignore list ------------------------------------------------------------------
#
# Lines this project has decided never to voice: the war-effort tallies, whose $$2113w is a
# counter the game expands against a live server, and Blizzard's own debris. The decision is
# made in the web app and lives in Postgres, where it carries a reason and an author. The
# committed file is the only form the Python CLI and rsync can read - neither has a
# database - so `make quests-export-ignores` writes it from the table.
#
# It used to be pulled from the droplet over ssh, because the droplet's database was the
# only one that had the rows. `make quests-sync` brings them home now, so the export is a
# local read like every other one here, and deploy/web/sql/export_ignores.sql is gone with
# the target that fed it.
#
# One direction only, either way. Editing the file by hand would put it out of step with
# the table the app reads, and the app is what everyone looks at.

# The corpus, which lives in Postgres now.
#
# corpus/corpus.json.gz is still what the Python CLI and the addon build read, and still
# committed -- producing audio and shipping a pack need no database, which is the promise
# requirements.txt makes. What changed is that the file is an EXPORT of quest_line rather
# than something maintained by hand, exactly as zones' manifest.json is an export of the
# take table. The check that proves the table carries everything is that an import followed
# by an export leaves the file byte-identical.

# Run from the pipeline's directory, because the CLI's default paths are relative to it.
#
# The database is the one a pack is built from, LOCAL_DB, unless DATABASE_URL names another.
# The pack build reads corpus.json.gz and ignored.json, never Postgres, so package-audio
# exports both first: a pack built after a sync without them had the new takes' mp3s in
# audio/ and no lookup entry pointing at them -- a contributed quest, voiced on the site,
# silent in game.
QUESTS_CLI = cd $(QUESTS_DIR) && DATABASE_URL="$(or $(DATABASE_URL),$(LOCAL_DB))" $(abspath $(PYTHON)) cli-main.py

import-corpus: ## corpus/corpus.json.gz -> quest_line (needs DATABASE_URL and psycopg2)
	@$(QUESTS_CLI) import-corpus

# A translation goes from the world database straight into Postgres: it has no committed file
# and gets none, because nothing builds a pack from one yet and the site is where it is
# edited. LOCALE is required rather than defaulted -- run without it, this would have had to
# guess which language to write over, and every guess is a language somebody is editing.
# LOCALE and not LANG, which every shell already sets to something like en_US.UTF-8.
import-locale: ## vmangos *_locN -> quest_line + entity_name (LOCALE=deDE; needs MySQL and DATABASE_URL)
	@test -n "$(LOCALE)" || { echo "import-locale: set LOCALE, e.g. LOCALE=deDE"; exit 2; }
	@$(QUESTS_CLI) import-locale --lang $(LOCALE)

# The gaps vmangos leaves -- esMX, zhTW and zhCN text it lacks, and ptBR, which it has no
# column for -- filled in the local dump from TrinityCore's releases, before import-locale.
# Only empty cells, and only where TDB's English is vmangos's; see the tool. The three dumps
# are the extracted TDB_full_world_335, TDB_full_world_12xx and TDB_full_hotfixes_12xx .sql
# from https://github.com/TrinityCore/TrinityCore/releases. ARGS=--dry-run counts instead.
fill-locales: ## Fill vmangos's empty *_locN columns from TrinityCore (TDB335= TDB_WORLD= TDB_HOTFIXES=)
	@test -n "$(TDB335)" -a -n "$(TDB_WORLD)" -a -n "$(TDB_HOTFIXES)" || { \
	  echo "fill-locales: set TDB335, TDB_WORLD and TDB_HOTFIXES to the extracted TDB .sql files"; exit 2; }
	@cd $(QUESTS_DIR) && $(abspath $(PYTHON)) tools/fill_locales_from_tdb.py \
	  --tdb335 "$(abspath $(TDB335))" --tdb-world "$(abspath $(TDB_WORLD))" \
	  --tdb-hotfixes "$(abspath $(TDB_HOTFIXES))" $(ARGS)

# Italian, which no client runs in, from the QuestIT community's addon: quest text, quest
# titles and the few book pages it has, as 'community' rows. Run again on each of their
# releases; an edit made on the site is kept. ARGS=--dry-run counts instead.
import-questit: ## Import a QuestIT release into itIT (QUESTIT=~/Downloads/QuestIT)
	@test -n "$(QUESTIT)" || { echo "import-questit: set QUESTIT to a QuestIT release folder"; exit 2; }
	@cd $(QUESTS_DIR) && $(abspath $(PYTHON)) tools/import_questit.py "$(abspath $(patsubst ~/%,$(HOME)/%,$(QUESTIT)))" $(ARGS)

export-corpus: check-synced ## quest_line -> corpus/corpus.json.gz (ARGS=--check to compare instead)
	@$(QUESTS_CLI) export-corpus $(ARGS)

# A language's gossip as its client shows it, for that language's Gossip pack to match on
# (tts_cli/locale_text.py). Written to the language's work area rather than committed: the
# pack build is the only thing that reads it, and it already needs the database for the corpus.
export-locale-text: ## quest_line localeText -> build/quests/$(LOCALE)/locale-text.json.gz (LOCALE=esMX)
	@test -n "$(filter-out enUS,$(LOCALE))" || { echo "export-locale-text: set LOCALE to a language other than English, e.g. LOCALE=esMX"; exit 2; }
	@$(QUESTS_CLI) export-locale-text --lang $(LOCALE) --out $(abspath build/quests/$(LOCALE)/locale-text.json.gz)

# What a quest-log play button names the giver on a client in another language. Committed into
# the addon, not a pack: the name follows the client's language, not the voice the player
# chose, so it has to be there with the English packs too (tts_cli/giver_names.py). Rerun after
# an import-locale; the files only change when a name does.
export-giver-names: ## entity_name -> addons/Spoken_Quests/Locale/Names/<lang>.lua
	@$(QUESTS_CLI) export-giver-names --out-dir $(abspath addons/Spoken_Quests/Locale/Names)

# What a gossip line reads as on every other client, and which files are one moment. Committed
# into the addon for export-giver-names' reason: the text follows the client, not the voice
# (tts_cli/gossip_text.py). Rerun after an import-locale, a broadcast-text upload or a relink.
export-gossip-text: ## quest_line, broadcast_text -> addons/Spoken_Quests/Gossip/<lang>.lua, Aliases.lua
	@$(QUESTS_CLI) export-gossip-text --out-dir $(abspath addons/Spoken_Quests/Gossip)

export-ignores: ## line_ignore -> corpus/ignored.json, replacing the old ssh export
	@$(QUESTS_CLI) export-ignores $(ARGS)

# THE DROPLET IS UPSTREAM FOR EVERYTHING THE APP WRITES.
#
# Corpus edits and takes are made on the site, so the droplet's database is the newer side
# of both. A laptop is upstream for exactly one thing: a fresh vmangos extract, which is
# imported locally and pushed before a build. At build time, then, data only ever flows one
# way -- which is what makes it safe to package from a laptop at all.
#
# Before this, a pack built here could ship words production had already corrected, and
# nothing would have said so. The corpus was a committed file, so "is it current?" meant
# "did you pull recently?", and the answer was somebody's memory.

sync: require-droplet ## Replace the local quests corpus and takes with the droplet's (DESTRUCTIVE)
	@$(DB_ENV) scripts/db/sync-section.sh quests \
	  quest_line quest_line_speaker quest_spawn quest_corpus_meta line_ignore
	@echo "==> rebuild the committed corpus with:  make quests-export-corpus"

# Refuses to let a stale laptop ship a pack, or asks first. scripts/db/check-synced.sh has
# the reasoning; every section's packaging runs the same one.
check-synced: ## Compare the local quests data with the droplet's, and prompt if they differ
	@$(DB_ENV) scripts/db/check-synced.sh quests

# One store at a time, for the case a release half-landed: a zip CurseForge took and Wago
# refused, or the other way round. Re-running `release` would upload the file twice to the
# store that already has it, which each of them shows as a duplicate rather than ignoring.
release-wago: ## Upload the built zips to Wago only (needs WAGO_TOKEN)
	@./scripts/quests/release.sh --store=wago

release-curse: ## Upload the built zips to CurseForge only (needs CURSEFORGE_TOKEN)
	@./scripts/quests/release.sh --store=curseforge
