# Spoken -- the dispatcher.
#
# The two projects keep their own Makefiles. They collide on fifteen target names
# (help, package, release, push, pull, rollback and the rest) and each target is
# commented with the failure it exists to prevent, several of them guarding an
# rsync --delete against audio that cannot be regenerated. Merging them is a
# semantic rewrite of about a hundred targets with nothing to show for it, so
# they are dispatched instead and the prefix disambiguates:
#
#     make quests-package        ->  make -f make/quests.mk package
#     make zones-release-dry     ->  make -f make/zones.mk  release-dry
#     make web-dev               ->  make -f make/web.mk    dev
#     make books-extract         ->  make -f make/books.mk  extract
#
# Both .mk files use paths relative to the repo root, so they must be run from
# here -- which is what the pattern rules below guarantee.

.DEFAULT_GOAL := help

LUA ?= $(shell command -v luajit || command -v lua5.1)

.PHONY: help test test-player contribute-fixtures lint package-all \
        descriptions descriptions-check descriptions-published \
        character-models \
        audio-release audio-release-dry

help: ## Show this help
	@printf 'Spoken\n\n'
	@printf '  make quests-<target>   see make/quests.mk  (make quests-help)\n'
	@printf '  make zones-<target>    see make/zones.mk   (make zones-help)\n'
	@printf '  make web-<target>      see make/web.mk     (make web-help)\n'
	@printf '  make books-<target>    see make/books.mk   (make books-help)\n\n'
	@printf 'Repo-wide:\n'
	@grep -E '^[a-z-]+:.*?## ' $(firstword $(MAKEFILE_LIST)) \
	  | sed 's/:.*## /|/' | awk -F'|' '{printf "  %-16s %s\n", $$1, $$2}'

quests-%:
	@$(MAKE) --no-print-directory -f make/quests.mk $*

zones-%:
	@$(MAKE) --no-print-directory -f make/zones.mk $*

web-%:
	@$(MAKE) --no-print-directory -f make/web.mk $*

books-%:
	@$(MAKE) --no-print-directory -f make/books.mk $*

test-player: ## Run the addons' Lua tests (needs luajit)
	@[ -n "$(LUA)" ] || { echo "No luajit found: brew install luajit"; exit 1; }
	@$(LUA) tests/lua/quest_dispatch_test.lua
	@$(LUA) tests/lua/quest_autoplay_test.lua
	@$(LUA) tests/lua/quest_overlay_test.lua
	@$(LUA) tests/lua/easter_egg_test.lua
	@$(LUA) tests/lua/sound_utils_test.lua
	@$(LUA) tests/lua/queue_test.lua
	@$(LUA) tests/lua/sources_test.lua
	@$(LUA) tests/lua/api_contract_test.lua
	@$(LUA) tests/lua/contribute_envelope_test.lua
	@$(LUA) tests/lua/contribute_toc_test.lua
	@$(LUA) tests/lua/contribute_box_test.lua
	@$(LUA) tests/lua/quests_contribute_test.lua
	@$(LUA) tests/lua/player_frame_test.lua
	@$(LUA) tests/lua/taint_report_test.lua
	@$(LUA) tests/lua/zones_source_test.lua
	@$(LUA) tests/lua/zones_pending_test.lua
	@$(LUA) tests/lua/quests_source_test.lua
	@$(LUA) tests/lua/data_modules_test.lua
	@$(LUA) tests/lua/quests_language_test.lua
	@$(LUA) tests/lua/player_required_test.lua
	@$(LUA) tests/lua/duplicate_player_test.lua
	@$(LUA) tests/lua/zones_options_test.lua
	@$(LUA) tests/lua/quests_options_test.lua
	@$(LUA) tests/lua/books_source_test.lua
	@$(LUA) tests/lua/books_options_test.lua
	@$(LUA) tests/lua/books_reader_test.lua
	@$(LUA) tests/lua/books_playlist_test.lua
	@$(LUA) tests/lua/books_events_test.lua
	@$(LUA) tests/lua/books_contribute_test.lua
	@$(LUA) tests/lua/books_language_test.lua
	@$(LUA) tests/lua/gather_test.lua
	@$(LUA) tests/lua/zones_contribute_test.lua
	@$(LUA) tests/lua/zones_language_test.lua
	@$(LUA) tests/lua/migration_test.lua

# Rewrite the envelope fixtures the TypeScript reader is tested against. A diff here is the
# wire format changing, and that is a change the reader's tests must be part of.
contribute-fixtures:
	SPOKEN_WRITE_FIXTURES=1 $(LUA) tests/lua/contribute_envelope_test.lua

# The Python half needs its own venv:
#
#   cd pipelines/quests && python -m venv .venv \
#     && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
#
# tests/test_corpus.py skips itself without pandas, which is in requirements-extract.txt and
# pinned at a version with no wheel for this Python. See docs/quests/README.md#tests.

test: test-player ## Everything: both webs, the Python pipeline, the addons
	@pnpm -r test
	@[ -x pipelines/quests/.venv/bin/python ] || { \
	  echo "No venv at pipelines/quests/.venv -- see the comment above 'test' in the Makefile"; \
	  exit 1; }
	@cd pipelines/quests && ./.venv/bin/python -m pytest -q

lint: ## The checks CI gates on
	@pnpm -r typecheck
	@node scripts/check-addon-xml.mjs
	@node pipelines/zones/tools/validate.mjs
	@node scripts/descriptions.mjs --check
	@node pipelines/zones/tools/locale/check-strings.mjs

# The store project pages, for every addon. One tool over publishers/*/ rather than one
# per project: the pages are the same shape, and a second copy of this would be a second place
# for the summary limit and the published.json convention to drift.
#
# `descriptions-published` is a claim, not a check -- there is no API to read a live page back,
# so it records what you have just pasted. Run it after pasting, never before.

descriptions: ## Regenerate the addon READMEs and dist/descriptions*/ from publishers/
	@node scripts/descriptions.mjs --write

descriptions-check: ## Confirm the addon READMEs match publishers/
	@node scripts/descriptions.mjs

descriptions-published: ## Record the current descriptions as pasted into the site
	@node scripts/descriptions.mjs --published

# Not a target that runs itself -- scripts/character-models.mjs takes the listfile on stdin
# so this step never pulls 152 MB on its own. Run it by hand when a new race ships.

character-models: ## Print how to regenerate apps/web/src/lib/npc/character-models.json
	@sed -n '2,10p' scripts/character-models.mjs | sed -e 's/^\/\/ //' -e 's/^\/\/$$//'

# The sound packs' third channel. CurseForge takes them and Wago does not -- 280-452 MB a
# pack, and that upload endpoint answers 413 -- so a player who installed an addon from Wago
# gets its audio from a GitHub release instead.
#
# Not part of .github/workflows/release-addons.yaml, and it cannot be: that workflow builds
# its zips on the runner, and the audio is outside git. This uploads what the machine that
# generated it already has in dist/.

audio-release-dry: ## Show which pack releases `make audio-release` would cut
	@./scripts/audio-github-release.sh --dry-run

audio-release: ## Publish the built sound packs as GitHub releases (needs gh)
	@./scripts/audio-github-release.sh

package-all: ## Build every addon zip: the player, quests, zones
	@./scripts/spoken/package.sh
	@$(MAKE) --no-print-directory -f make/quests.mk package
	@$(MAKE) --no-print-directory -f make/zones.mk  package
