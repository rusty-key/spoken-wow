# The books pipeline: the vmangos extract, the corpus import, the addon export.
#
#     make books-extract     ->  make -f make/books.mk extract
#
# Its own file because AGENTS.md forbids merging the Makefiles: quests.mk and zones.mk
# already collide on fifteen target names and this one would collide with both.
#
# The MySQL is the quests pipeline's. One vmangos dump on the machine, loaded once and read
# by both extracts -- a second copy is hundreds of megabytes and another thing to keep in
# step with a dump refresh.
#
# The connection is configured through MYSQL_*, in the repo-root .env, the same five
# variables the quests extract reads -- one dump, one set of credentials. tools/extract.mjs
# loads that file over the shell for those five, for the reason tts_cli/env_vars.py loads
# its own with override=True: generic names are exported by other projects, and an ambient
# MYSQL_PASSWORD turns this into an access-denied error that reads like a missing dump.

.DEFAULT_GOAL := help
.PHONY: help db extract import export places lookup deploy deploy-copy status remove \
        import-locale pull-history pull-live pull-recorded package-acted acted sounds sync check-synced package package-audio release-dry release release-wago release-curse \
        release-audio-dry release-audio icon test \
        full-release

PIPELINE := pipelines/books
QUESTS   := pipelines/quests

help: ## List the books targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | sort \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

db: ## Start the vmangos MySQL (the quests pipeline's; loading the dump is its own job)
	@docker compose -f $(QUESTS)/docker-compose.yml up -d mysql

extract: ## vmangos -> pipelines/books/corpus/extract.json
	@node $(PIPELINE)/tools/extract.mjs

import: ## corpus/extract.json -> book_line (needs DATABASE_URL)
	@node $(PIPELINE)/tools/import.mjs

# A translation goes from the world DB straight into Postgres: nothing is exported from one
# yet, and the site is where it is edited. LOCALE and not LANG, which every shell sets.
import-locale: ## locales_page_text -> book_line + entity_name (LOCALE=deDE; needs DATABASE_URL)
	@test -n "$(LOCALE)" || { echo "import-locale: set LOCALE, e.g. LOCALE=deDE"; exit 2; }
	@node $(PIPELINE)/tools/import-locale.mjs --lang $(LOCALE)

export: ## book_line -> addons/Spoken_Books/Data/Books.lua (needs DATABASE_URL)
	@node $(PIPELINE)/tools/export.mjs

# Where each readable is, for Azeroth's Compendium. A TrinityCore world DB (the Forever repack's
# by default; PLACES_MYSQL_* in .env) and the client's map tables from wago.tools.
places: ## world DB + client maps -> addons/Spoken_Books/Data/Places.lua
	@node $(PIPELINE)/tools/places.mjs

lookup: ## take -> the pack's Data/Sounds.lua (LOCALE=xx: into build/books/xx; needs DATABASE_URL)
	@node $(PIPELINE)/tools/build-lookup.mjs --lang=$(or $(LOCALE),enUS)

#-------------------------------------------------------------------------------
# The narration
#
# Generation happens on the droplet -- that is where the site runs and where the queue
# spends the credits -- so the take archive lives there and comes here to be packaged and to
# be listened to in a client. Audio is not in git; see the root .gitignore.
#-------------------------------------------------------------------------------

include make/droplet.mk
# Books' own archive under the shared audio-history, the directory
# SPOKEN_BOOKS_AUDIO_HISTORY names in deploy/web/ecosystem.config.js.
REMOTE_HISTORY := $(REMOTE_ROOT)/shared/audio-history/books/
LOCAL_HISTORY  := pipelines/books/audio-history/

# macOS ships openrsync as /usr/bin/rsync, which reports itself as "2.6.9 compatible" and
# rejects --info. Prefer a real rsync 3.x anywhere on PATH.
RSYNC ?= $(shell for r in /opt/homebrew/bin/rsync /usr/local/bin/rsync $$(command -v rsync); do \
	[ -x "$$r" ] && "$$r" --version 2>/dev/null | head -1 | grep -q 'version 3' && { echo "$$r"; exit 0; }; \
	done)

# No -z: mp3 is already compressed. Never --delete: archived audio is only ever added to.
RSYNC_OPTS := -a --partial --info=stats1,progress2 --human-readable

# One direction only: production is upstream for every edit and every take. The recipe is
# shared with quests and zones -- see scripts/db/sync-section.sh. This used to fetch the
# takes but not book_line, so a page fixed on the site shipped with its old words.
sync: require-droplet ## Replace the local book text and takes with the droplet's (DESTRUCTIVE)
	@$(DB_ENV) scripts/db/sync-section.sh books book_line
	@echo "==> rebuild the pack's table with:  make books-lookup"

check-synced: ## Compare the local books data with the droplet's, and prompt if they differ
	@$(DB_ENV) scripts/db/check-synced.sh books

pull-history: require-droplet ## Fetch the droplet's archived takes (non-destructive)
	@mkdir -p $(LOCAL_HISTORY)
	@$(RSYNC) $(RSYNC_OPTS) -e "$(SSH)" $(DROPLET):$(REMOTE_HISTORY) $(LOCAL_HISTORY)
	@echo "==> pulled. Build the pack's Sounds/ with:  make books-sounds"

# Only the takes the pack is built from: the live ones, as the local database has them, so run
# `make books-sync` first. pull-history is the whole archive, for listening to old takes.
pull-live: require-droplet ## Fetch only the live takes the local database names (after sync)
	@$(DB_ENV) RSYNC="$(RSYNC)" scripts/audio/pull-live.sh books $(or $(LOCALE),enUS)

# The pack folder the client loads and the release zips: not kept, but assembled from the
# live takes and the archive before every build. See scripts/audio/sounds.mjs.
sounds: ## Assemble the pack's Sounds/ (LOCALE=xx: into build/books/xx) from the live takes
	@$(DB_ENV) node scripts/audio/sounds.mjs --lang=$(or $(LOCALE),enUS) books

# The voice actors' recordings (migration 0062) ship as an overlay pack of their own, which the
# player prefers over the generated pack where it has a line. Built from the `recording` table
# and the files under the archive's recorded/, not from the takes. See scripts/audio/acted.mjs.
pull-recorded: require-droplet ## Fetch the voice actors' live recordings the local database names (after sync)
	@$(DB_ENV) RSYNC="$(RSYNC)" scripts/audio/pull-live.sh books $(or $(LOCALE),enUS) recorded

package-acted: check-synced ## Build the voice-acted overlay zip into dist/ (LOCALE=xx, ACTED_VERSION=x.y.z)
	@$(DB_ENV) node scripts/audio/acted.mjs --lang=$(or $(LOCALE),enUS) --version=$(or $(ACTED_VERSION),1.0.0) books

acted: pull-recorded package-acted ## Pull the recordings and build the voice-acted overlay (after sync)

package: ## Zip the addon into dist/ (for a release)
	@./scripts/books/package.sh

# STORED, NOT DEFLATED. The payload is mp3, which is already compressed: deflate spends
# minutes on 450 MB to save well under a percent. -0 makes this a container rather than a
# compressor, which is all it needs to be.
#
# -X drops the extended attributes macOS attaches, so the zip is the same bytes wherever it
# is built.
#
# ZIPPED FROM INSIDE addons/, so the archive's top level is SpokenBooksAudio/ and it
# unpacks straight into a client's AddOns directory. Zipped from the repo root instead it
# carries an addons/ prefix, and unzipping lands it at AddOns/addons/SpokenBooksAudio,
# where the client will never look.
# From the database, against production's data: the lookup table is rebuilt here rather than
# on the droplet after every generation, which is what the site used to do.
ifneq ($(filter-out enUS,$(LOCALE)),)
package-audio: check-synced sounds lookup ## Zip the sound pack into dist/ (LOCALE=xx for a language's)
	@LOCALE="$(LOCALE)" ./scripts/books/package-audio.sh
else
package-audio: check-synced sounds lookup
	@mkdir -p dist
	@version=$$(sed -n 's/^## Version: //p' addons/SpokenBooksAudio/SpokenBooksAudio.toc); \
	 zip_path="$$PWD/dist/SpokenBooksAudio-$$version.zip"; \
	 rm -f "$$zip_path"; \
	 (cd addons && zip -r -0 -q -X "$$zip_path" SpokenBooksAudio \
	   -x '*.DS_Store' '*/.*'); \
	 printf '%s\n' "built dist/SpokenBooksAudio-$$version.zip"; \
	 printf '  %s mp3, %s\n' \
	   "$$(unzip -Z1 "$$zip_path" | grep -c '\.mp3$$')" \
	   "$$(du -h "$$zip_path" | cut -f1)"; \
	 shasum -a 256 "$$zip_path"
endif

# The in-game addon list reads a TGA or BLP, never the PNG or SVG in
# pipelines/books/assets/, so the icon is converted and committed -- an addon must build
# with no ffmpeg on the machine. Borrowed from the zones pipeline rather than copied: the
# script takes a source and a destination and knows nothing about which project it serves.
#
# Both addons carry the same icon: they install as a pair, and two icons would imply they
# are alternatives to each other.
icon: ## Rebuild both addons' AddonIcon.tga from pipelines/books/assets (needs ffmpeg)
	@python3 pipelines/zones/tools/make-icon.py pipelines/books/assets/spoken-books-512.png addons/Spoken_Books/Textures/AddonIcon.tga
	@cp addons/Spoken_Books/Textures/AddonIcon.tga addons/SpokenBooksAudio/Textures/AddonIcon.tga
	@echo "==> copied to addons/SpokenBooksAudio/Textures/AddonIcon.tga"

deploy: ## Symlink the addon into a client (CLIENT=era|anniversary|forever)
	@./scripts/books/deploy.sh

deploy-copy: ## Copy the addon into the client instead of symlinking
	@./scripts/books/deploy.sh --copy

status: ## Show what is installed in every client
	@./scripts/books/deploy.sh --status

remove: ## Uninstall the addon from every client
	@./scripts/books/deploy.sh --remove

test: ## The pipeline's unit tests
	@pnpm --filter @spoken/books-pipeline test

#-------------------------------------------------------------------------------
# The release
#
# Two CurseForge projects, uploaded by scripts/books/release.sh. Both zips have to be built
# first: the release script refuses a target whose zip is missing rather than uploading a
# stale one it found in dist/.
#-------------------------------------------------------------------------------

release-dry: ## Show what `make books-release` would upload to CurseForge and Wago
	@./scripts/books/release.sh --dry-run

release: ## Upload the built zips to CurseForge and Wago (needs both tokens)
	@./scripts/books/release.sh

# One store at a time, for the case a release half-landed: a zip CurseForge took and Wago
# refused, or the other way round. Re-running `release` would upload the file twice to the
# store that already has it, which each of them shows as a duplicate rather than ignoring.
release-wago: ## Upload the built zips to Wago only (needs WAGO_TOKEN)
	@./scripts/books/release.sh --store=wago

release-curse: ## Upload the built zips to CurseForge only (needs CURSEFORGE_TOKEN)
	@./scripts/books/release.sh --store=curseforge

# One language's sound pack, to CurseForge (and Wago where its page has an id). English's is
# `release` as always; LOCALE picks another language's page under publishers/books/.
release-audio-dry: ## Show what uploading the sound pack would send (LOCALE=xx for a language)
	@./scripts/books/release.sh --dry-run --lang=$(or $(LOCALE),enUS) audio

release-audio: ## Upload the sound pack (LOCALE=xx for a language's)
	@./scripts/books/release.sh --lang=$(or $(LOCALE),enUS) audio

# The whole pack release, from production's data to the stores, with one question before
# anything is uploaded. Each step is its own target and still runs alone; this is their order.
#
# The version is SpokenBooksAudio.toc's, so bump it and add its `## <version>` section to
# docs/books/CHANGELOG.md first; both uploads quote that section. The pack goes to CurseForge
# only -- Wago answers 413 to a file this size (scripts/lib/wago.sh) -- and to GitHub, which
# is where a Wago player gets it.
full-release: require-droplet ## Sync, pull live takes, build and upload the sound pack (LOCALE=xx for a language's)
	@$(MAKE) --no-print-directory -f make/books.mk sync
	@$(MAKE) --no-print-directory -f make/books.mk pull-live LOCALE=$(LOCALE)
	@$(MAKE) --no-print-directory -f make/books.mk package-audio LOCALE=$(LOCALE)
	@./scripts/books/release.sh --dry-run --store=curseforge --lang=$(or $(LOCALE),enUS) audio
	@./scripts/audio-github-release.sh --dry-run books $(or $(LOCALE),enUS)
	@printf 'Upload the books pack to CurseForge and GitHub? [y/N] '; \
	  read -r answer; [ "$$answer" = y ] || { echo aborted; exit 1; }
	@./scripts/books/release.sh --store=curseforge --lang=$(or $(LOCALE),enUS) audio
	@./scripts/audio-github-release.sh books $(or $(LOCALE),enUS)
