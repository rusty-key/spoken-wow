# Entry points for the scripts under scripts/zones/ and pipelines/zones/tools/.
# Everything here is a thin wrapper -- the scripts remain runnable on their own.

.DEFAULT_GOAL := help
.PHONY: help package package-audio check validate validate-audio lint deploy deploy-copy \
        status remove clean voice voice-zones lookup export \
        pull-history pull-live pull-recorded package-acted acted history-status sounds ssh-check sync check-synced full-release \
        icon lore-import lore-import-names lore-export lore-check lore-rewrite aliases languages locale-check \
        areas forever-areas pictures \
        release release-dry release-wago release-curse release-audio release-audio-dry

# The \# escapes are required: an unescaped # starts a make comment, even
# inside a $(shell ...) call.
VERSION := $(shell sed -n 's/^\#\# Version:[[:space:]]*//p' addons/Spoken_Places/Spoken_Places.toc | head -1)
ZIP := dist/Spoken_Places-$(VERSION).zip

help: ## Show this help
	@echo "Spoken Zones $(VERSION)"
	@echo
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

package: check ## Build dist/Spoken_Places-<version>.zip for upload
	@./scripts/zones/package.sh

check: validate lint locale-check ## Run every pre-package check

# descriptions, descriptions-check and descriptions-published moved to the root Makefile when
# the generator grew to cover every project's pages rather than only this one's.

validate: ## Sanity-check the generated Lua data files
	@node pipelines/zones/tools/validate.mjs

# The in-game addon list reads a TGA or BLP, never the PNG or SVG in pipelines/zones/assets/, so the
# icon is converted and committed. Both addons carry the same shield: they install as a
# pair, and two icons would imply they are alternatives to each other.
icon: ## Rebuild both addons' AddonIcon.tga from pipelines/zones/assets/spoken-zones-512.png (needs ffmpeg)
	@python3 pipelines/zones/tools/make-icon.py pipelines/zones/assets/spoken-zones-512.png addons/Spoken_Places/Textures/AddonIcon.tga
	@cp addons/Spoken_Places/Textures/AddonIcon.tga addons/SpokenZonesAudio/Textures/AddonIcon.tga
	@echo "==> copied to addons/SpokenZonesAudio/Textures/AddonIcon.tga"

lint: ## Block-balance check on the addon's Lua
	@python3 pipelines/zones/tools/lua-syntax-check.py

deploy: ## Symlink the addon into a client (CLIENT=era|anniversary)
	@./scripts/zones/deploy.sh

deploy-copy: ## Copy the addon into the client instead of symlinking
	@./scripts/zones/deploy.sh --copy

status: ## Show what is installed in every client
	@./scripts/zones/deploy.sh --status

remove: ## Uninstall the addon from every client
	@./scripts/zones/deploy.sh --remove

clean: ## Remove build output
	@rm -rf dist
	@echo "removed dist/"

#-------------------------------------------------------------------------------
# Voicelines
#
# None of these can spend a credit. They report on lines, build the addon's lookup
# table and check it; cutting audio is the site's, on the droplet. See
# docs/places/VOICE.md, "Generating voicelines".
#-------------------------------------------------------------------------------

# Which language's takes and pack the voice targets act on: English, or LOCALE=esMX for
# another language's pack (addons/SpokenZonesAudio_esMX). pipelines/zones/tools/voice/store.mjs
# reads it; sounds, pull-live and package-audio take the same LOCALE, so one variable on the
# command line moves the whole chain and a run cannot build one language's lookup over
# another's clips.
VOICE_LANG = SPOKEN_ZONES_LANG=$(or $(LOCALE),enUS)

# The manifest comes from Postgres when DATABASE_URL is set and from the committed files
# otherwise, and the repo-root .env sets it -- so a laptop whose Postgres is not running gets
# ECONNREFUSED out of every audio target, which is not a failure anyone reading
# "validate the sound pack" expects.
#
# Passing it empty is what env.mjs documents as "use the files": an already-set variable always
# wins over .env. Defined-but-empty counts, so this is the default and
# `make zones-package-audio DATABASE_URL=postgres://...` still reads the database.
VOICE_DB = DATABASE_URL=$(DATABASE_URL)

voice: ## Report on every voiceline: what is missing, stale, and what it would cost
	@$(VOICE_LANG) node pipelines/zones/tools/voice/generate.mjs --all

voice-zones: ## The same, over the 49 zone lines only
	@$(VOICE_LANG) node pipelines/zones/tools/voice/generate.mjs --all --zones-only

lookup: ## Rebuild the addon's audio lookup table (exports the manifest first)
	@$(VOICE_LANG) node pipelines/zones/tools/voice/export-manifest.mjs
	@$(VOICE_LANG) $(VOICE_DB) node pipelines/zones/tools/voice/build-lookup.mjs

validate-audio: ## Check manifest, files on disk and lookup table agree (DATABASE_URL=... to use the droplet)
	@$(VOICE_LANG) $(VOICE_DB) node pipelines/zones/tools/voice/validate-audio.mjs

#-------------------------------------------------------------------------------
# The site's database
#
# Optional to the addon build: with DATABASE_URL unset every target above still
# works against pipelines/zones/tools/voice/manifest.json. The schema and its migrations
# belong to apps/web now; see make/web.mk and deploy/web/README.md.
#-------------------------------------------------------------------------------

export: ## Write pipelines/zones/tools/voice/manifest.json from the database
	@$(VOICE_LANG) node pipelines/zones/tools/voice/export-manifest.mjs

#-------------------------------------------------------------------------------
# The lore corpus
#
# The text lives in the database so it can be rewritten from the explorer, and the
# addon ships the two committed Lua files. These targets are the traffic between
# them. Neither is needed to build the addon from a clone: without DATABASE_URL the
# committed files are the whole story, which is what keeps the release path free of
# Postgres.
#-------------------------------------------------------------------------------

lore-import: ## Seed lore_line from the committed Lua data files (idempotent)
	@node pipelines/zones/tools/lore/import.mjs

# A language's place names, from the alias table the addon ships (built from the game's
# AreaTable). The prose has no such source and is written on the site. LOCALE and not LANG,
# which every shell sets.
lore-import-names: ## Name zones and subzones in a language from tools/seed/area-names.json (LOCALE=deDE)
	@test -n "$(LOCALE)" || { echo "lore-import-names: set LOCALE, e.g. LOCALE=deDE"; exit 2; }
	@node pipelines/zones/tools/lore/import-names.mjs --lang $(LOCALE)

lore-export: ## Write addons/Spoken_Places/Data/<lang>/*.lua, every translated language, from the database
	@node pipelines/zones/tools/lore/export.mjs

lore-check: ## Confirm the committed Lua matches the database
	@node pipelines/zones/tools/lore/export.mjs --check

# Translations arrive as a spreadsheet, not through a model: a sheet goes out with the
# English beside the blanks and comes back filled in. Both are free. The upload
# follows the scraper's rules -- unchanged text records nothing, and a hand edit made
# in the explorer is never overwritten -- so a re-upload is always safe to run.
lore-rewrite: ## Rewrite one zone's lore from the full wiki article (ZONE=1420, costs credits)
	@test -n "$(ZONE)" || { echo "usage: make lore-rewrite ZONE=1420"; exit 1; }
	@node pipelines/zones/tools/rewrite-lore.mjs --zone $(ZONE) --variant both --dry-run

#-------------------------------------------------------------------------------
# Languages
#
# A non-English client reports its own area names -- "Sengende Schlucht", not
# "Burning Steppes" -- and the corpus is keyed by the English one in every
# language. Without these tables such a client matches no subzone at all, which
# is what it did for the addon's whole life before they existed. Regenerate only
# when a client build pinned in pipelines/lib/wago.mjs moves.
#-------------------------------------------------------------------------------

aliases: ## Rebuild Data/<locale>/Aliases.lua and seed/area-names.json from the client's AreaTable
	@node pipelines/zones/tools/locale/build-aliases.mjs
	@node pipelines/zones/tools/locale/build-languages.mjs

#-------------------------------------------------------------------------------
# Which places each client has
#
# The lore export keeps the places either client can name (seed/era-areas.json and
# seed/camelot-areas.json, Era's and Forever's AreaTable), and Data/ForeverAreas.lua says which
# only Forever has, which Forever names differently and which no Forever player reaches
# (seed/forever-places.json, by hand). Run areas when a pinned build moves, forever-areas after
# it, after a lore export or after an edit to forever-places.json.
#-------------------------------------------------------------------------------

areas: ## Refetch seed/era-areas.json and seed/camelot-areas.json from the pinned client builds
	@node pipelines/zones/tools/fetch-era-areas.mjs
	@node pipelines/zones/tools/fetch-era-areas.mjs --forever

forever-areas: ## Rebuild Data/ForeverAreas.lua from the area seeds and seed/forever-places.json
	@node pipelines/zones/tools/lore/export-forever-areas.mjs

# The reviewed pictures in the choices folder, as the shipped textures, Data/Pictures.lua and
# Textures/Pictures/CREDITS.md. A folder holding only the places being worked on is safe: the
# rest keep their pictures, and nothing is deleted unless ARGS=--prune says the folder holds
# every place. Needs Python with numpy, Pillow and scipy.
pictures: ## Prepare the reviewed zone pictures (CHOICES=<folder>, ARGS=--force or --prune)
	@python3 pipelines/zones/tools/pictures/prepare.py $(if $(CHOICES),--choices "$(CHOICES)") $(ARGS)

languages: ## Rebuild Data/Languages.lua -- what each language covers, and whether it ships
	@node pipelines/zones/tools/locale/build-languages.mjs

# Reports coverage and confirms Languages.lua still matches it. An untranslated
# language is not a failure; a stale Languages.lua is, because it decides which
# languages players are offered.
locale-check: ## Report per-language string coverage, and check Languages.lua is current
	@node pipelines/zones/tools/locale/check-strings.mjs
	@node pipelines/zones/tools/locale/build-languages.mjs --check

#-------------------------------------------------------------------------------
# The droplet
#
# The site is deployed by GitHub Actions on every push to master. Everything here is the
# half CI does not do: bringing production's audio and database home to build a pack from.
# See deploy/web/README.md.
#
#   make pull-history      production's archived takes, the only audio there is
#   make sync              production's lore and takes
#
# Droplet setup, releases and rollback are make/web.mk's: one /srv/spoken tree, one
# deploy, one place holding the guards.
#-------------------------------------------------------------------------------

include make/droplet.mk

# /srv/spoken, not /srv/zonelore. The cutover has run: the take archive lives under
# /srv/spoken/shared (symlinks into the block volume at /mnt/voice/spoken) and
# the `spoken` pm2 app serves them. REMOTE_ROOT is set in make/droplet.mk.


# macOS ships openrsync as /usr/bin/rsync, which reports itself as "2.6.9 compatible"
# and rejects --info. Prefer a real rsync 3.x anywhere on PATH.
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)

# Zones' own archive, beside quests' and books' under one shared audio-history -- the
# directory SPOKEN_ZONES_AUDIO_HISTORY names in deploy/web/ecosystem.config.js. The root
# holds all three sections, so syncing against it would pull the other two sections' takes
# into this one's folder.
REMOTE_HISTORY := $(DROPLET):$(REMOTE_ROOT)/shared/audio-history/zones/
# No -z: mp3 is already compressed. Never --delete: archived audio is only ever added to.
# -e is not optional: without it rsync spawns a plain ssh that cannot authenticate.
HISTORY_RSYNC_OPTS := -a --partial --human-readable --info=progress2 -e "$(SSH)"

# Fail with an explanation rather than an rsync usage dump or a bare publickey refusal.
define preflight
	@[ -n "$(RSYNC)" ] || { echo "No rsync 3.x found. macOS ships openrsync, which lacks --info."; \
	                        echo "Install one:  brew install rsync"; exit 1; }
	@[ -f $(DEPLOY_KEY) ] || { echo "No deploy key at $(DEPLOY_KEY)."; \
	                           echo "It is the key the droplet's deploy user authorises."; \
	                           echo "Point at another with:  make $@ DEPLOY_KEY=~/.ssh/other"; exit 1; }
	@case "$(DROPLET)" in root@*) \
	  echo "DROPLET is $(DROPLET). Use deploy@ instead: pm2 daemons are per-user, so a"; \
	  echo "reload as root finds no 'zonelore' process and the new release stays unserved."; \
	  exit 1;; esac
endef

ssh-check: require-droplet ## Confirm the droplet is reachable and set up
	$(preflight)
	@$(SSH) $(DROPLET) 'echo "ok: $$(hostname)"; ls -d $(REMOTE_ROOT)/bin $(REMOTE_ROOT)/shared 2>/dev/null || echo "missing tree - run: make bootstrap"'

# The archive is the only audio: every take the site has cut, one file each, never changed.
# It comes here one way, to be packaged and listened to; nothing on this machine makes a
# take, so there is nothing to send back.
pull-history: require-droplet ## Fetch the droplet's archived takes (non-destructive)
	$(preflight)
	@mkdir -p pipelines/zones/audio-history
	$(RSYNC) $(HISTORY_RSYNC_OPTS) $(REMOTE_HISTORY) pipelines/zones/audio-history/
	@echo "==> pulled. Build the pack's Sounds/ with:  make zones-sounds"

# Only the takes the pack is built from: the live ones, as the local database has them, so run
# `make zones-sync` first. pull-history is the whole archive, for listening to old takes.
pull-live: require-droplet ## Fetch only the live takes the local database names (after sync)
	$(preflight)
	@$(DB_ENV) RSYNC="$(RSYNC)" scripts/audio/pull-live.sh zones $(or $(LOCALE),enUS)

history-status: require-droplet ## Compare archived take count and size on both sides
	@echo "local:   $$(find pipelines/zones/audio-history -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ') takes, $$(du -sh pipelines/zones/audio-history 2>/dev/null | cut -f1 || echo 0)"
	@$(SSH) $(DROPLET) 'echo "droplet: $$(find $(REMOTE_ROOT)/shared/audio-history/zones -name "*.mp3" 2>/dev/null | wc -l | tr -d " ") takes, $$(du -sh $(REMOTE_ROOT)/shared/audio-history/zones 2>/dev/null | cut -f1)"' \
	  || echo "droplet unreachable (try: make ssh-check)"

# The pack's Sounds/ is not kept: it is assembled from the live takes and the archive, and
# made again before every build. See scripts/audio/sounds.mjs.
sounds: ## Assemble the pack's Sounds/ (LOCALE=xx: into build/zones/xx) from the live takes
	@$(DB_ENV) node scripts/audio/sounds.mjs --lang=$(or $(LOCALE),enUS) zones

# The voice actors' recordings (migration 0062) ship as an overlay pack of their own, which the
# player prefers over the generated pack where it has a line. Built from the `recording` table
# and the files under the archive's recorded/, not from the takes. See scripts/audio/acted.mjs.
pull-recorded: require-droplet ## Fetch the voice actors' live recordings the local database names (after sync)
	@$(DB_ENV) RSYNC="$(RSYNC)" scripts/audio/pull-live.sh zones $(or $(LOCALE),enUS) recorded

package-acted: check-synced ## Build the voice-acted overlay zip into dist/ (LOCALE=xx, ACTED_VERSION=x.y.z)
	@$(DB_ENV) node scripts/audio/acted.mjs --lang=$(or $(LOCALE),enUS) --version=$(or $(ACTED_VERSION),1.0.0) zones

acted: pull-recorded package-acted ## Pull the recordings and build the voice-acted overlay (after sync)

#-------------------------------------------------------------------------------
# Moving the database between machines
#
# One direction only: production is upstream for every edit and every take, so data comes
# home and never goes back. The recipe is shared with quests and books -- see
# scripts/db/sync-section.sh.
#-------------------------------------------------------------------------------

sync: require-droplet ## Replace the local zones lore and takes with the droplet's (DESTRUCTIVE)
	@$(DB_ENV) scripts/db/sync-section.sh zones lore_line
	@echo "==> bring the addon into step with:  make zones-lore-export && make zones-lookup"

check-synced: ## Compare the local zones data with the droplet's, and prompt if they differ
	@$(DB_ENV) scripts/db/check-synced.sh zones

#-------------------------------------------------------------------------------
# Deploying
#-------------------------------------------------------------------------------

# From the database, against production's data: the lookup table is rebuilt here rather than
# on the droplet after every generation, which is what the site used to do.
package-audio: check-synced sounds lookup validate-audio ## Build the sound-pack zip (LOCALE=esMX for that language's)
	@LOCALE="$(or $(LOCALE),enUS)" ./scripts/zones/package-audio.sh

release-dry: ## Show what `make release` would upload to CurseForge and Wago
	@./scripts/zones/release.sh --dry-run

release: ## Upload the built zips to CurseForge and Wago (needs both tokens)
	@./scripts/zones/release.sh

# One language's sound pack, to CurseForge (and Wago where its page has an id). English's is
# `release` as always; LOCALE picks another language's page under publishers/zones/.
release-audio-dry: ## Show what uploading the sound pack would send (LOCALE=xx for a language)
	@./scripts/zones/release.sh --dry-run --lang=$(or $(LOCALE),enUS) audio

release-audio: ## Upload the sound pack (LOCALE=xx for a language's)
	@./scripts/zones/release.sh --lang=$(or $(LOCALE),enUS) audio

# One store at a time, for the case a release half-landed: a zip CurseForge took and Wago
# refused, or the other way round. Re-running `release` would upload the file twice to the
# store that already has it, which each of them shows as a duplicate rather than ignoring.
release-wago: ## Upload the built zips to Wago only (needs WAGO_TOKEN)
	@./scripts/zones/release.sh --store=wago

release-curse: ## Upload the built zips to CurseForge only (needs CURSEFORGE_TOKEN)
	@./scripts/zones/release.sh --store=curseforge

# The whole pack release, from production's data to the stores, with one question before
# anything is uploaded. Each step is its own target and still runs alone; this is their order.
#
# The version is SpokenZonesAudio.toc's, so bump it and add its `## <version> — audio` section
# to docs/places/CHANGELOG.md first; both uploads quote that section. The pack goes to
# CurseForge only -- Wago answers 413 to a file this size (scripts/lib/wago.sh) -- and to
# GitHub, which is where a Wago player gets it.
full-release: require-droplet ## Sync, pull live takes, build and upload the sound pack (LOCALE=xx for a language's)
	@$(MAKE) --no-print-directory -f make/zones.mk sync
	@$(MAKE) --no-print-directory -f make/zones.mk pull-live LOCALE=$(LOCALE)
	@$(MAKE) --no-print-directory -f make/zones.mk package-audio LOCALE=$(LOCALE)
	@./scripts/zones/release.sh --dry-run --store=curseforge --lang=$(or $(LOCALE),enUS) audio
	@./scripts/audio-github-release.sh --dry-run zones $(or $(LOCALE),enUS)
	@printf 'Upload the zones pack to CurseForge and GitHub? [y/N] '; \
	  read -r answer; [ "$$answer" = y ] || { echo aborted; exit 1; }
	@./scripts/zones/release.sh --store=curseforge --lang=$(or $(LOCALE),enUS) audio
	@./scripts/audio-github-release.sh zones $(or $(LOCALE),enUS)
